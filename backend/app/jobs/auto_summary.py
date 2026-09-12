"""Auto-regenerate and auto-publish summaries (DECISION #6)."""

from __future__ import annotations

import logging
import re
import time
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.ai.registry import default_model, get_provider, is_credential_rejection
from app.core.db import engine
from app.models_tg import ChatDestination, Post, Summary, utc_now
from app.prompts.summary import format_summary_prompt
from app.services.ai_keys import Purpose, record_validation, resolve_ai_key
from app.services.channel_setting_groups import channel_is_frozen, load_groups_by_id
from app.services.credentials import CHAT_DESTINATION_NOT_FOUND
from app.services.follows import followed_channels_for
from app.services.logs import upsert_llm_log, upsert_publish_log
from app.services.network_settings import (
    load_network_settings,
    resolve_proxies,
    resolve_proxy_concurrency,
)
from app.services.post_filters import apply_analysis_window
from app.services.publish import publish_summary_text
from app.services.scraper_jobs import create_job, has_active_sync_job
from app.services.summaries import apply_summary_payload
from app.services.sync_meta import touch_sync
from app.services.sync_orchestrator import run_sync_job
from app.services.tenancy import may_act_on

logger = logging.getLogger(__name__)

_regenerating: set[str] = set()


_CITATION_RE = re.compile(r"\[([^\]]+?)\s*#(\d+)\]")


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
) -> None:
    """Record an auto-publish that produced no message, and commit it.

    The scheduler has no response to fail; the publish log is the only place a
    person sees that a configured auto-publish did nothing.
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
            "status": "failed",
            "error": error,
            "timestamp": int(time.time() * 1000),
            "text_sent": text_sent,
        },
        owner_id,
    )
    session.commit()
    touch_sync(session, "publish_logs")


def _detail(exc: BaseException) -> str:
    """The sentence a person should read, for either kind of failure.

    `str(HTTPException)` is `"404: AI key not found"` — the status code is noise
    in a log row that already has a status column, and the log's own search
    covers `error`, so the prefix would be something people match on by
    accident. Everything else stringifies as itself.
    """
    return str(exc.detail) if isinstance(exc, HTTPException) else str(exc)


async def _run_summary_call(
    session: Session,
    *,
    owner_id: uuid.UUID,
    user_id: uuid.UUID | None,
    key_id: str | None,
    model: str,
    prompt: str,
) -> str:
    """Spend the Summary's own Key on one completion, and leave a row either way.

    **Every failure files a failed `LLMLog` before it propagates.** The
    scheduler is unattended, so a refusal that only raises makes "my Key stopped
    working" and "auto-regeneration is off" the same observation — the argument
    `_auto_publish` already makes for its side, and BYOK-03 applies it here. The
    two failures it has to cover are a `key_id` naming somebody else's row,
    which `resolve_ai_key` refuses **before** `decrypt_token` (multi-user-tenancy
    ticket 33), and a Provider that has started rejecting a Key that used to
    work.

    A rejection also clears the Key's validation stamp, which is the signal the
    settings panel reads — the same `_note_rejection` the interactive routes
    call, for the same reason: nothing re-validates on a schedule, so the only
    thing that ever finds out is a call somebody was making anyway.

    **It does not touch `autoRegenerate`.** The schedule survives its own bad
    night; one failed run turning the feature off is work lost quietly, which is
    the failure mode this is a correction to.

    `full_request` is composed here from the prompt rather than taken from the
    outgoing HTTP request. That is what keeps a credential out of the log:
    Gemini carries its key as a URL query parameter, so a request object dumped
    verbatim would write it into a row the Account can read back and export.
    `tests/services/test_llm_log_provenance.py` asserts it.
    """
    # Composed **before** the Key is resolved, because the refusal this has to
    # record happens inside `resolve_ai_key` — a foreign `aiKeyId` never reaches
    # a Provider, and a log built after the resolution would be exactly the
    # silent return this function exists to remove. Such a row names no
    # provider, which is the honest answer: no endpoint was reached.
    log: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "model": model,
        "prompt": prompt,
        "model_config_json": {"temperature": 0.7},
        # Provider-neutral, and composed rather than dumped. The shape this
        # replaces was Gemini's wire format, written for every Provider — which
        # since BYOK-02 is confidently false, and sits directly beside the
        # `provider` and `base_url` columns saying so. What a person opens this
        # row to read is the prompt; what they must never find in it is the
        # credential, which is why it is built here rather than taken from the
        # request that went out (a Gemini key travels as a query parameter).
        "full_request": {"prompt": prompt},
        "type": "summary",
    }
    start = time.perf_counter()
    try:
        key = resolve_ai_key(
            session, user_id=user_id, purpose=Purpose.SUMMARY, key_id=key_id
        )
    except Exception as exc:
        # **`Exception`, not `HTTPException`**, and the difference is the whole
        # promise this function makes. `resolve_ai_key` answers a missing or
        # foreign Key with an `HTTPException`, which is the case anybody thinks
        # of — but it also reaches `decrypt_token`, which raises a bare
        # `ValueError` outside `local` for a row that is not encrypted (a
        # `SECRET_KEY` rotation, a restore carrying plaintext). And `aiKeyId`
        # comes out of an open JSON bag, so a non-string value makes
        # `session.get` raise out of the driver rather than answering 404.
        #
        # Catching only the tidy one puts both of those back in the silent
        # column — no log row, nothing in the History, "my Key broke"
        # indistinguishable from "auto-regeneration is off". That is the exact
        # failure this function exists to remove, so the net is as wide as the
        # claim.
        _log_ai_failure(
            session, log, owner_id=owner_id, error=_detail(exc), start=start
        )
        raise
    log["provider"] = key.provider
    log["base_url"] = key.base_url
    provider = get_provider(
        provider=key.provider, api_key=key.api_key, base_url=key.base_url
    )
    try:
        result = await provider.complete(prompt, model=model, temperature=0.7)
    except Exception as exc:
        if key.credential_id and is_credential_rejection(exc):
            record_validation(session, key.credential_id, valid=False)
        _log_ai_failure(session, log, owner_id=owner_id, error=str(exc), start=start)
        raise
    duration = time.perf_counter() - start
    upsert_llm_log(
        session,
        {
            **log,
            "response": result.text,
            "full_response": result.model_dump(),
            "status": "success",
            "timestamp": int(time.time() * 1000),
            "duration": duration,
        },
        owner_id,
    )
    return result.text


def _log_ai_failure(
    session: Session,
    log: dict[str, Any],
    *,
    owner_id: uuid.UUID,
    error: str,
    start: float,
) -> None:
    """Record an AI call that produced no text.

    Committed on its own, because the caller is about to raise and roll the rest
    of the regeneration back. A log row that vanished with the failure it
    documents would be worse than none: the History would show a gap and no
    reason for it.
    """
    upsert_llm_log(
        session,
        {
            **log,
            "response": "",
            "status": "failed",
            "error": error,
            "timestamp": int(time.time() * 1000),
            "duration": time.perf_counter() - start,
        },
        owner_id,
    )
    session.commit()
    touch_sync(session, "llm_logs")


def _extract_cited_posts(text: str, posts: Sequence[Post]) -> dict[str, dict[str, Any]]:
    cited: dict[str, dict[str, Any]] = {}
    for match in _CITATION_RE.finditer(text):
        channel_name = match.group(1).strip()
        post_id = int(match.group(2))
        key = f"{channel_name}-{post_id}"
        if key not in cited:
            for p in posts:
                if p.channel_name == channel_name and p.post_id == post_id:
                    cited[key] = {
                        "id": p.post_id,
                        "channelName": p.channel_name,
                        "text": p.text,
                        "date": p.date,
                        "timestamp": p.timestamp,
                    }
                    break
    return cited


def _default_metadata(summary: Summary, extra: dict[str, Any]) -> str:
    channels = summary.channels or []
    return (
        f"📊 *Analysis Metadata*\n"
        f"🕒 *Time Range:* {datetime.utcfromtimestamp(summary.start_date / 1000).isoformat()} - "
        f"{datetime.utcfromtimestamp(summary.end_date / 1000).isoformat()}\n"
        f"📡 *Channels Used:* {len(channels)}\n"
        f"📋 *Channel List:* {', '.join(f'@{c}' for c in channels)}\n"
        f"🤖 *AI Model:* {summary.model or default_model()}\n"
        f"📝 *Posts Analyzed:* {extra.get('postCount') or summary.post_count or 0}"
    )


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
    duration_ms = summary.end_date - summary.start_date
    if duration_ms < 60_000:
        return False
    # Serving out a backoff. Read as a timestamp rather than recomputed from
    # the counter, so changing the ladder above does not retroactively move a
    # wait that is already being served.
    retry_after = extra.get("autoRegenerateRetryAfter")
    if isinstance(retry_after, int | float) and now < retry_after:
        return False
    target_time = summary.end_date + duration_ms
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
    duration_ms = summary.end_date - summary.start_date
    new_start = summary.end_date
    new_end = summary.end_date + duration_ms

    await _sync_channels_for_summary(session, summary.channels or [], new_end, owner_id)

    # The successor window opens exactly where its predecessor closed, so this
    # is the read the half-open rule exists for: an inclusive end summarised
    # the Post on the shared millisecond twice, once in each Summary (AW-01).
    posts = session.exec(
        apply_analysis_window(
            select(Post).where(
                col(Post.channel_name).in_(summary.channels or []),
                col(Post.is_anchor) == False,  # noqa: E712
            ),
            new_start,
            new_end,
        ).order_by(col(Post.timestamp).desc())
    ).all()

    if not posts:
        full_text = (
            f"No new posts found in the selected channels between "
            f"{datetime.utcfromtimestamp(new_start / 1000).isoformat()} and "
            f"{datetime.utcfromtimestamp(new_end / 1000).isoformat()}."
        )
    else:
        posts_text = "\n\n---\n\n".join(
            f"[{p.channel_name}] ID: {p.post_id}\nDate: {p.date}\nContent: {p.text}"
            for p in posts
        )
        model = summary.model or default_model()
        prompt = format_summary_prompt(
            channels=summary.channels or [],
            language=summary.language,
            posts_text=posts_text,
        )
        # An unattended regeneration is still the owner's Artifact, so it is
        # charged to the owner's Key and never to the Operator's, and it uses
        # the Key the Account chose when it turned auto-regeneration on rather
        # than whichever one happens to be newest at 4am (BYOK-03).
        #
        # `aiKeyId` rides `Summary.extra`, which `upsert_summary` fills from
        # unrecognised keys in the request body — so it is **client-supplied and
        # untrusted**, exactly like `publishBotId` two fields along.
        # `resolve_ai_key` checks it against `summary.user_id` before
        # `decrypt_token` for the reason multi-user-tenancy ticket 33 gives, and
        # `_run_summary_call` turns its refusal into a failed log row.
        #
        # `summary.user_id` may be NULL on a deployment old enough to predate
        # the stamp. `resolve_ai_key` refuses that rather than falling back:
        # nobody's Key can pay, and the fallback that would "fix" it is the
        # Operator paying, which is what BYOK exists to stop.
        full_text = await _run_summary_call(
            session,
            owner_id=owner_id,
            user_id=summary.user_id,
            key_id=extra.get("aiKeyId"),
            model=model,
            prompt=prompt,
        )

    cited = _extract_cited_posts(full_text, posts)
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
        "autoRegenerate": True,
        "autoPublish": extra.get("autoPublish"),
        "publishBotId": extra.get("publishBotId"),
        "publishChatId": extra.get("publishChatId"),
        "sendMetadata": extra.get("sendMetadata", True),
        "metadataText": extra.get("metadataText"),
        "postSearch": extra.get("postSearch"),
        "semanticSearchQuery": extra.get("semanticSearchQuery"),
        "semanticSearchRespectsChannels": extra.get("semanticSearchRespectsChannels"),
        "postCount": len(posts),
    }

    new_summary = Summary(
        id=new_id,
        user_id=owner_id,
        text=full_text,
        channels=summary.channels,
        start_date=new_start,
        end_date=new_end,
        language=summary.language,
        model=summary.model,
        post_count=len(posts),
        timestamp=int(time.time() * 1000),
        extra=new_extra,
    )
    session.add(new_summary)
    # citedPosts is corpus-sized and lives in tg_summary_payloads, not `extra`
    # — see SummaryPayload. Routed through the aggregate so the derived
    # columns on tg_summaries stay in step with it.
    apply_summary_payload(
        session,
        new_id,
        user_id=owner_id,
        updates={"cited_posts": cited},
    )

    summary.extra = {**extra, "autoRegenerate": False}
    summary.updated_at = utc_now()
    session.add(summary)
    session.commit()
    touch_sync(session, "summaries")

    if (
        extra.get("autoPublish")
        and extra.get("publishBotId")
        and extra.get("publishChatId")
        and posts
    ):
        await _auto_publish(
            session, new_summary, new_extra, full_text, owner_id=owner_id
        )

    return new_id


async def _auto_publish(
    session: Session,
    summary: Summary,
    extra: dict[str, Any],
    full_text: str,
    *,
    owner_id: uuid.UUID,
) -> None:
    """Publish a regenerated Summary, as its own owner and nobody else.

    Both ids come out of `Summary.extra`, which `upsert_summary` fills from
    unknown keys in the request body — so they are whatever the account that
    saved the Summary typed, not something the server chose. Resolving either by
    primary key alone let a Summary name another account's credential and
    destination, and the scheduler would decrypt that account's token and send
    as its bot (ticket 33).

    The acting owner is `owner_id`, the Summary's own owner, because there is
    no `current_user` out here. It arrives as a required keyword rather than
    being read off the row: ticket 21 made the caller's query select only owned
    Summaries, and passing the narrowed id is what carries that guarantee here
    instead of re-deriving it from a column the type still calls optional. The credential half is checked inside `publish_summary_text`,
    where the token is decrypted; this function owns the destination half,
    which never reaches that service — only the `chat_id` string does.

    A refusal writes a **failed publish log** rather than returning quietly.
    Nobody is watching the scheduler, so a silent return makes "auto-publish is
    misconfigured" and "auto-publish is off" the same observation. An absent
    destination used to do exactly that; it now answers as the foreign one does,
    with the same text, which is `assert_owner`'s rule that the body is the
    other half of the answer.
    """
    bot_id = str(extra.get("publishBotId"))
    chat_dest_id = str(extra.get("publishChatId"))
    dest = session.get(ChatDestination, chat_dest_id)
    if not dest or not may_act_on(owner_id=dest.user_id, user_id=owner_id):
        logger.warning(
            "Chat destination %s not available for auto-publish", chat_dest_id
        )
        _log_publish_failure(
            session,
            summary,
            owner_id=owner_id,
            bot_id=bot_id,
            # `chat_id` holds a **Telegram** chat id everywhere else in this
            # function, and it is one of the columns the publish-log search
            # covers. Putting the `ChatDestination` row id here instead would
            # hide these refusals from an operator filtering by their real chat
            # id, and hand anyone who did match one a value that looks like a
            # chat id and is not. There is no Telegram chat id to record — that
            # is the whole failure — so both columns stay empty and the row id
            # travels in the error, where nothing parses it.
            chat_id="",
            chat_name="",
            error=f"{CHAT_DESTINATION_NOT_FOUND}: {chat_dest_id}",
            text_sent=full_text,
        )
        return

    network = load_network_settings(session)
    proxies = resolve_proxies(network)
    proxy_concurrency = resolve_proxy_concurrency(network)
    metadata = None
    if extra.get("sendMetadata", True):
        metadata = extra.get("metadataText") or _default_metadata(summary, extra)

    try:
        result = await publish_summary_text(
            session,
            acting_user_id=owner_id,
            credential_id=bot_id,
            chat_id=dest.chat_id,
            text=full_text,
            metadata_text=metadata,
            proxies=proxies,
            proxy_concurrency=proxy_concurrency,
            tor_auto_rotate=bool(network.get("torAutoRotate")),
            tor_rotation_threshold=int(network.get("torRotationThreshold") or 10),
        )
        text_sent = f"{metadata}\n\n{full_text}" if metadata else full_text
        upsert_publish_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "summary_id": summary.id,
                "bot_id": bot_id,
                "bot_name": bot_id,
                "chat_id": dest.chat_id,
                "chat_name": dest.name,
                "status": "success",
                "timestamp": int(time.time() * 1000),
                "full_response": result,
                "text_sent": text_sent,
            },
            owner_id,
        )
        session.commit()
        touch_sync(session, "publish_logs")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Auto-publish failed for summary %s", summary.id)
        _log_publish_failure(
            session,
            summary,
            owner_id=owner_id,
            bot_id=bot_id,
            chat_id=dest.chat_id,
            chat_name=dest.name,
            error=str(exc),
            text_sent=full_text,
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
