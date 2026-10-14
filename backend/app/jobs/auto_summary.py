"""Auto-regenerate and auto-publish summaries (DECISION #6).

A tick no longer calls a Provider itself (SFR-03, ADR-030). It opens the
successor Summary first, as Generate does, hands it the chain, and starts an
Attempt flagged `scheduled` on the generation Lane. The worker runs it like
any other, retries a transient failure once, and reports the end back here
(`after_scheduled_attempt`): a success is auto-published, a quota failure
switches the chain off. Any other failure leaves the successor Failed with its
Attempt, visible in History, and the chain moves on from it.
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Session, col, select

from app.core.db import engine
from app.jobs.summary_generation import start_attempt
from app.models_tg import Post, Summary, utc_now
from app.prompts.summary import format_summary_prompt
from app.schemas.scope import FrozenScope
from app.services.channel_setting_groups import channel_is_frozen, load_groups_by_id
from app.services.follows import followed_channels_for
from app.services.logs import upsert_publish_log
from app.services.post_filters import apply_analysis_window
from app.services.publications import (
    DestinationNotFound,
    resolve_destination,
    send_publication,
)
from app.services.scraper_jobs import create_job, has_active_sync_job
from app.services.summaries import (
    FAILED_STATUS,
    apply_summary_payload,
    derived_scope,
    is_incomplete,
    refresh_summary_derived_columns,
)
from app.services.sync_meta import touch_sync
from app.services.sync_orchestrator import run_sync_job

logger = logging.getLogger(__name__)

_regenerating: set[str] = set()


def _log_publish_failure(
    session: Session,
    summary: Summary,
    *,
    owner_id: uuid.UUID,
    bot_id: str,
    chat_id: str,
    chat_name: str,
    error: str,
    text_sent: str,
    status: str = "failed",
) -> None:
    """Record an auto-publish that produced no message, and commit it.

    The scheduler has no response to fail; the publish log is the only place a
    person sees that a configured auto-publish did nothing. `skipped` is one
    it chose not to send.
    """
    upsert_publish_log(
        session,
        {
            "id": str(uuid.uuid4()),
            "summary_id": summary.id,
            "bot_id": bot_id,
            "bot_name": bot_id,
            "chat_id": chat_id,
            "chat_name": chat_name,
            "status": status,
            "error": error,
            "timestamp": int(time.time() * 1000),
            "text_sent": text_sent,
        },
        owner_id,
    )
    session.commit()
    touch_sync(session, "publish_logs")


def _scope_of(summary: Summary) -> FrozenScope | None:
    """The window and channels this Summary was made from, or `None`.

    AW-07 dropped the `start_date` / `end_date` / `channels` trio these callers
    read, so the frozen Scope is the only copy. `None` on a row a legacy write
    door opened without one; each caller says what it does about that, and none
    of them invents boundaries.
    """
    return FrozenScope.from_stored(summary.scope)


def _summary_extra(s: Summary) -> dict[str, Any]:
    return s.extra or {}


#: How long a Summary waits after a failed run, doubling per consecutive
#: failure, capped at a day.
#:
#: **The other half of "a failed run does not disable the schedule."** That rule
#: is right and this is what makes it affordable. `_is_due` stays true forever
#: once the window has passed, and the scheduler ticks every 60 seconds
#: (`AUTO_SUMMARY_JOB_INTERVAL_SECONDS`), so without a damper a Summary whose
#: Key cannot work retries 1,440 times a day — 1,440 failed log rows, 1,440
#: authenticated calls to a Provider already rejecting them, and an etag bump
#: every minute that re-invalidates the log list for every open client.
#:
#: The likeliest case is not exotic: an Account that had `autoRegenerate` on
#: before BYOK and has not saved a Key yet fails on `AI_KEY_MISSING_DETAIL`
#: every single tick.
#:
#: Backoff rather than a cap, because a cap is the auto-disable wearing a
#: different hat — the Summary would stop for good on a Provider outage that
#: cleared itself. A day is the ceiling because that is roughly how long
#: somebody takes to notice a Key needs re-saving, and the first retry is still
#: a minute away.
_RETRY_BACKOFF_MS = 60_000
_RETRY_BACKOFF_CAP_MS = 24 * 60 * 60 * 1000


def _retry_after(failures: int) -> int:
    """Milliseconds to wait before the nth consecutive retry."""
    return int(
        min(_RETRY_BACKOFF_MS * 2 ** max(0, failures - 1), _RETRY_BACKOFF_CAP_MS)
    )


def _is_due(summary: Summary, now: int) -> bool:
    extra = _summary_extra(summary)
    if not extra.get("autoRegenerate"):
        return False
    scope = _scope_of(summary)
    # A Summary with no frozen Scope is never due. It has no window to shift,
    # and the successor it would open has nothing to inherit — the same refusal
    # `derived_scope` makes one layer down, made here so the scheduler skips it
    # rather than failing it every tick.
    if scope is None:
        return False
    duration_ms = scope.end - scope.start
    if duration_ms < 60_000:
        return False
    # Serving out a backoff. Read as a timestamp rather than recomputed from
    # the counter, so changing the ladder above does not retroactively move a
    # wait that is already being served.
    retry_after = extra.get("autoRegenerateRetryAfter")
    if isinstance(retry_after, int | float) and now < retry_after:
        return False
    target_time = scope.end + duration_ms
    return now >= target_time


async def _sync_channels_for_summary(
    session: Session,
    channel_names: list[str],
    end_ts: int,
    owner_id: uuid.UUID,
) -> None:
    """Sync the stale channels this Summary reads, as the Summary's owner.

    `owner_id` is non-optional because its only caller now has a narrowed one:
    the `SyncJob` this creates is `USER_OWNED`, and `str(x) if x else None` was
    the spelling that let the scheduler mint one nobody owns (ticket 21).
    """
    if has_active_sync_job():
        return
    # Paired with the follow since ticket 22: "is this channel frozen" is a
    # question about this account's follow, not about the shared Channel.
    operator_channels = {
        channel.name: (channel, follow)
        for channel, follow in followed_channels_for(session, user_id=owner_id)
    }
    groups_by_id = load_groups_by_id(session)
    stale = []
    for name in channel_names:
        pair = operator_channels.get(name)
        if pair is None:
            continue
        ch = pair[0]
        if (
            not channel_is_frozen(pair, groups_by_id)
            and (ch.last_updated or 0) < end_ts
        ):
            stale.append(ch)
    if not stale:
        return
    job = await create_job(
        channel_entries=[(ch.id, ch.name) for ch in stale],
        source="Auto-Regenerate Summary (scheduler)",
        user_id=str(owner_id),
    )
    await run_sync_job(job, owner_id)


async def _regenerate_one(
    session: Session, summary: Summary, *, owner_id: uuid.UUID
) -> str | None:
    """Regenerate `summary` into a new Summary owned by `owner_id`.

    **`owner_id` is a required keyword, and it is the Summary's own owner.** It
    used to be `summary.user_id or get_operator_user_id(session)`, computed
    here, and the `or` was load-bearing in the wrong direction: `run_auto_summary`
    selected `Summary.user_id IS NULL` rows on purpose, so every unowned Summary
    that came due was regenerated into a **brand new** unowned Summary, with its
    `SummaryPayload`, its `LLMLog` and its `PublishLog` stamped the same way.
    The unowned population did not shrink as ticket 34's backfill implied — it
    was topped up every tick, which is why closing the creation path matters
    more than the backfill that preceded it.

    Taking it as an argument rather than resolving it is what moves the decision
    to the one place that can make it: the caller's query, which now selects
    only Summaries that have an owner.
    """
    extra = _summary_extra(summary)
    # The one place the successor window is computed, shared with the browser's
    # submission path (AW-06). It used to be three lines here and three more in
    # `AIContext`, and the two had drifted: the worker recorded a complete Scope
    # and the browser recorded none, for the same chain.
    scope = derived_scope(summary, "successor")
    new_start, new_end = scope.start, scope.end
    # The derived Scope's own channels, not a second read of the row. AW-07
    # dropped `Summary.channels`, and `derived_scope` carries the predecessor's
    # list forward, so there is one list here where there were two.
    channel_names = list(scope.channels)

    await _sync_channels_for_summary(session, channel_names, new_end, owner_id)

    # The successor window opens exactly where its predecessor closed, so this
    # is the read the half-open rule exists for: an inclusive end summarised
    # the Post on the shared millisecond twice, once in each Summary (AW-01).
    posts = session.exec(
        apply_analysis_window(
            select(Post).where(
                col(Post.channel_name).in_(channel_names),
                col(Post.is_anchor) == False,  # noqa: E712
            ),
            new_start,
            new_end,
        ).order_by(col(Post.timestamp).desc())
    ).all()

    new_id = str(int(time.time() * 1000))
    new_extra = {
        # The spread is what carries `aiKeyId` (BYOK-03) onto the Summary that
        # comes due next, and it is not incidental: the regenerated row is the
        # one the scheduler picks up tomorrow, so a chain that dropped the
        # choice would revert to "whichever Key is newest" after exactly one
        # night, with nothing anywhere saying it changed. Re-listing the key
        # below would be the redundant half of this, not the guard —
        # `test_llm_log_provenance.py::test_the_regenerated_summary_carries_
        # the_key_forward` is, and it fails if this spread ever narrows.
        **{k: v for k, v in extra.items() if k not in _NOT_INHERITED},
        # The successor takes the chain **now**, before its Attempt runs (SFR-03).
        # A failed tick leaves it Failed and still carrying the chain, so the
        # next tick derives the following window from it rather than retrying
        # this one every minute; each missed window stays behind as one Failed
        # Summary somebody can retry by hand.
        "autoRegenerate": True,
        "autoPublish": extra.get("autoPublish"),
        "publishBotId": extra.get("publishBotId"),
        "publishChatId": extra.get("publishChatId"),
        # Off unless set on explicitly (SUMTAB-09).
        "sendMetadata": extra.get("sendMetadata") is True,
        "metadataText": extra.get("metadataText"),
        "postSearch": extra.get("postSearch"),
        "semanticSearchQuery": extra.get("semanticSearchQuery"),
        "semanticSearchRespectsChannels": extra.get("semanticSearchRespectsChannels"),
        "postCount": len(posts),
    }
    prompt: str | None = None
    if posts:
        posts_text = "\n\n---\n\n".join(
            f"[{p.channel_name}] ID: {p.post_id}\nDate: {p.date}\nContent: {p.text}"
            for p in posts
        )
        prompt = format_summary_prompt(
            channels=channel_names,
            language=summary.language,
            posts_text=posts_text,
        )
        # Failed until an Attempt finishes it, as Generate opens its Summary:
        # a worker that never gets to it leaves it Failed, not blank.
        new_extra["status"] = FAILED_STATUS
        text = ""
    else:
        text = (
            f"No new posts found in the selected channels between "
            f"{datetime.utcfromtimestamp(new_start / 1000).isoformat()} and "
            f"{datetime.utcfromtimestamp(new_end / 1000).isoformat()}."
        )

    new_summary = Summary(
        id=new_id,
        user_id=owner_id,
        text=text,
        scope=scope.stored(),
        language=summary.language,
        model=summary.model,
        post_count=len(posts),
        timestamp=int(time.time() * 1000),
        extra=new_extra,
    )
    session.add(new_summary)
    # The prompt is corpus-sized and lives in tg_summary_payloads, not `extra`
    # — see SummaryPayload. Routed through the aggregate so the derived
    # columns on tg_summaries stay in step with it.
    payload = apply_summary_payload(
        session,
        new_id,
        user_id=owner_id,
        updates={"prompt_text": prompt} if prompt is not None else {"cited_posts": {}},
    )
    refresh_summary_derived_columns(new_summary, payload)

    summary.extra = {**extra, "autoRegenerate": False}
    summary.updated_at = utc_now()
    session.add(summary)
    session.commit()
    touch_sync(session, "summaries")

    if prompt is not None:
        # An unattended regeneration is still the owner's Artifact, so it is
        # charged to the owner's Key and never to the Operator's, and it uses
        # the Key the Account chose when it turned auto-regeneration on rather
        # than whichever one happens to be newest at 4am (BYOK-03).
        #
        # `aiKeyId` rides `Summary.extra`, which `upsert_summary` fills from
        # unrecognised keys in the request body — so it is **client-supplied and
        # untrusted**, exactly like `publishBotId` two fields along.
        # `start_attempt` checks it against the owner before `decrypt_token`
        # for the reason multi-user-tenancy ticket 33 gives, and records a
        # refusal as the successor's failed Attempt and a failed log row.
        start_attempt(
            session,
            new_id,
            user_id=owner_id,
            model=None,
            key_id=extra.get("aiKeyId"),
            temperature=None,
            scheduled=True,
        )

    return new_id


async def after_scheduled_attempt(
    summary_id: str, *, outcome: str, kind: str | None
) -> None:
    """What the worker hands back when a scheduled Attempt ends.

    A success is auto-published when the Summary asks for it. A quota failure
    switches the chain off, so it does not go on spending against an empty Key
    every window; any other failure leaves it on (BYOK-03's correction).
    """
    with Session(engine) as session:
        summary = session.get(Summary, summary_id)
        if summary is None:
            return
        extra = _summary_extra(summary)
        if outcome == "succeeded":
            if (
                extra.get("autoPublish")
                and extra.get("publishBotId")
                and extra.get("publishChatId")
            ):
                await _auto_publish(session, summary, owner_id=summary.user_id)
            return
        if kind == "quota" and extra.get("autoRegenerate"):
            summary.extra = {**extra, "autoRegenerate": False}
            summary.updated_at = utc_now()
            session.add(summary)
            session.commit()
            touch_sync(session, "summaries")


async def _auto_publish(
    session: Session, summary: Summary, *, owner_id: uuid.UUID
) -> None:
    """Publish a regenerated Summary, as its own owner and nobody else.

    Planned and sent by `send_publication`, exactly as the Summary tab's
    Publish does (SUMTAB-09): the owner's settings, the Summary's own
    send-metadata flag (off unless set on explicitly), one publish log.

    Both ids come out of `Summary.extra`, which `upsert_summary` fills from
    unknown keys in the request body — so they are whatever the account that
    saved the Summary typed, not something the server chose. Resolving either by
    primary key alone let a Summary name another account's credential and
    destination, and the scheduler would decrypt that account's token and send
    as its bot (ticket 33). `send_publication` refuses both before any decrypt.

    The acting owner is `owner_id`, the Summary's own owner, because there is
    no `current_user` out here. It arrives as a required keyword rather than
    being read off the row: ticket 21 made the caller's query select only owned
    Summaries, and passing the narrowed id is what carries that guarantee here
    instead of re-deriving it from a column the type still calls optional.

    A refusal writes a **failed publish log** rather than returning quietly.
    Nobody is watching the scheduler, so a silent return makes "auto-publish is
    misconfigured" and "auto-publish is off" the same observation. An absent
    destination answers as the foreign one does, with the same text, which is
    `assert_owner`'s rule that the body is the other half of the answer.
    """
    extra = _summary_extra(summary)
    bot_id = str(extra.get("publishBotId"))
    chat_dest_id = str(extra.get("publishChatId"))
    if is_incomplete(summary):
        # A kept Partial response stops short. A person may publish one by
        # hand, with a line saying so; nobody unattended should (SFR-03).
        _log_publish_failure(
            session,
            summary,
            owner_id=owner_id,
            bot_id=bot_id,
            chat_id="",
            chat_name="",
            error="Not published: this Summary is Incomplete.",
            text_sent="",
            status="skipped",
        )
        return
    # Named in any failure after the destination resolved, as the searchable
    # chat columns; empty only when the destination itself is the failure.
    chat_id = chat_name = ""
    try:
        dest = resolve_destination(session, chat_dest_id, user_id=owner_id)
        chat_id, chat_name = dest.chat_id, dest.name
        await send_publication(
            session,
            summary,
            user_id=owner_id,
            bot_id=bot_id,
            destination_id=chat_dest_id,
            include_metadata=extra.get("sendMetadata") is True,
            metadata_in_first_part=extra.get("metadataInFirstPart") is True,
        )
    except DestinationNotFound as exc:
        logger.warning(
            "Chat destination %s not available for auto-publish", chat_dest_id
        )
        _log_publish_failure(
            session,
            summary,
            owner_id=owner_id,
            bot_id=bot_id,
            # `chat_id` holds a **Telegram** chat id everywhere else, and it is
            # one of the columns the publish-log search covers. There is no
            # Telegram chat id to record — that is the whole failure — so both
            # columns stay empty and the row id travels in the error, where
            # nothing parses it.
            chat_id="",
            chat_name="",
            error=f"{exc}: {chat_dest_id}",
            text_sent=summary.text,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Auto-publish failed for summary %s", summary.id)
        _log_publish_failure(
            session,
            summary,
            owner_id=owner_id,
            bot_id=bot_id,
            chat_id=chat_id,
            chat_name=chat_name,
            error=str(exc),
            text_sent=summary.text,
        )


#: Keys the regenerated Summary does **not** inherit from the one it replaces.
#:
#: `autoRegenerate` is re-set below (the chain moves to the successor). The two
#: backoff keys are how a success clears the ladder: a run that produced a
#: Summary is the proof the Key works, so the fresh row starts on attempt zero
#: rather than serving out a wait earned by whatever was broken last night.
#:
#: Clearing by *not inheriting* rather than by assigning `None`: `extra` is an
#: open bag whose keys are absent or present, and an explicit null would travel
#: to the client as a field the schema never declared.
#:
#: `semanticSearchRespectsTimeRange` is a retired key (AW-01), and it is here
#: rather than simply deleted from the list below because the spread is what
#: carries it: an unattended chain copies its predecessor's bag forward every
#: night, so a flag nothing sets any more would keep minting rows on Summaries
#: created long after the control that wrote it was removed.
_NOT_INHERITED = (
    "autoRegenerate",
    "autoRegenerateFailures",
    "autoRegenerateRetryAfter",
    "semanticSearchRespectsTimeRange",
)


def _record_failure(summary_id: str) -> None:
    """Count one consecutive failure and push the next attempt out.

    Its own `Session`, because the caller's has just been rolled back by the
    exception this is reacting to.

    Writes to `extra` rather than to a column: this is scheduler bookkeeping
    with no wire shape and no reader outside this module, which is exactly what
    the open bag is for. A migration for two integers nobody queries would be
    the expensive way to say the same thing.
    """
    with Session(engine) as session:
        row = session.get(Summary, summary_id)
        if row is None:
            return
        extra = _summary_extra(row)
        failures = int(extra.get("autoRegenerateFailures") or 0) + 1
        row.extra = {
            **extra,
            "autoRegenerateFailures": failures,
            "autoRegenerateRetryAfter": int(time.time() * 1000)
            + _retry_after(failures),
        }
        session.add(row)
        session.commit()
        touch_sync(session, "summaries")


async def run_auto_summary() -> dict[str, Any]:
    now = int(time.time() * 1000)
    regenerated: list[str] = []
    errors: list[str] = []

    with Session(engine) as session:
        # Owned Summaries only. The `OR user_id IS NULL` branch this replaces is
        # what made `_regenerate_one` a producer of unowned rows rather than
        # merely a consumer of them: an unowned Summary coming due was
        # regenerated into a new unowned Summary, so ticket 34's backfill could
        # never catch up with it.
        #
        # Nothing is stranded by the narrowing. Ticket 34's migration
        # (`c0d1e2f3a4b5`) stamped every `tg_summaries` row that existed, and
        # PR 1 of this ticket closes the writers that could add another, so on
        # any migrated database this selects exactly what the old predicate did.
        # The operator filter is deliberately gone with it — a Summary
        # regenerates as *its own* owner, which is the question this job was
        # answering with the deployment's identity instead.
        stmt = select(Summary).where(col(Summary.user_id).is_not(None))
        summaries = session.exec(stmt).all()
        due = [s for s in summaries if _is_due(s, now) and s.id not in _regenerating]

    for summary in due:
        _regenerating.add(summary.id)
        try:
            with Session(engine) as session:
                row = session.get(Summary, summary.id)
                if not row or not _is_due(row, now):
                    continue
                if row.user_id is None:
                    # Re-read in its own session, so the ownership the query
                    # above selected on is asserted again rather than assumed.
                    # Narrowing here is also what lets `_regenerate_one` take a
                    # non-optional owner without a cast.
                    continue
                new_id = await _regenerate_one(session, row, owner_id=row.user_id)
                if new_id:
                    regenerated.append(new_id)
        except Exception as exc:  # noqa: BLE001
            # **A failed run leaves the schedule alone** (BYOK-03). This used to
            # switch `autoRegenerate` off whenever the error text mentioned a
            # quota, a 429 or a rate limit, which was defensible while every
            # call spent the Operator's one key and one Account could burn the
            # deployment's whole allowance. Under BYOK the Account is billed by
            # its own Provider, so there is nothing left to protect and the
            # behaviour is only a way to lose work quietly: a Provider that was
            # busy for ninety seconds turned the feature off for good, in a
            # `extra` flag nobody looks at, with no notification anywhere.
            #
            # The failure is recorded and *paced*, not acted on.
            # `_run_summary_call` has already filed a failed `LLMLog` the
            # Account can find in its History, and the Summary stays due — but
            # due immediately, on a 60-second tick, so the backoff below is
            # what keeps "keeps retrying" from meaning "1,440 times a day".
            logger.exception("Auto-summary failed for %s", summary.id)
            errors.append(f"{summary.id}: {exc}")
            _record_failure(summary.id)
        finally:
            _regenerating.discard(summary.id)

    return {"regenerated": regenerated, "errors": errors}
