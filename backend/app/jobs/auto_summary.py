"""Auto-regenerate and auto-publish summaries (DECISION #6)."""

from __future__ import annotations

import logging
import re
import time
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlmodel import Session, col, select

from app.ai.registry import default_model, get_provider
from app.core.config import settings
from app.core.db import engine
from app.models_tg import ChatDestination, Post, Summary, utc_now
from app.prompts.summary import format_summary_prompt
from app.services.channel_setting_groups import channel_is_frozen, load_groups_by_id
from app.services.credentials import CHAT_DESTINATION_NOT_FOUND
from app.services.follows import followed_channels_for
from app.services.logs import upsert_llm_log, upsert_publish_log
from app.services.network_settings import (
    load_network_settings,
    resolve_proxies,
    resolve_proxy_concurrency,
)
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


def _is_due(summary: Summary, now: int) -> bool:
    extra = _summary_extra(summary)
    if not extra.get("autoRegenerate"):
        return False
    duration_ms = summary.end_date - summary.start_date
    if duration_ms < 60_000:
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

    posts = session.exec(
        select(Post)
        .where(
            col(Post.channel_name).in_(summary.channels or []),
            col(Post.timestamp) >= new_start,
            col(Post.timestamp) <= new_end,
            col(Post.is_anchor) == False,  # noqa: E712
        )
        .order_by(col(Post.timestamp).desc())
    ).all()

    if not posts:
        full_text = (
            f"No new posts found in the selected channels between "
            f"{datetime.utcfromtimestamp(new_start / 1000).isoformat()} and "
            f"{datetime.utcfromtimestamp(new_end / 1000).isoformat()}."
        )
    else:
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY not configured")
        posts_text = "\n\n---\n\n".join(
            f"[{p.channel_name}] ID: {p.post_id}\nDate: {p.date}\nContent: {p.text}"
            for p in posts
        )
        model = summary.model or default_model()
        provider = get_provider("gemini")
        prompt = format_summary_prompt(
            channels=summary.channels or [],
            language=summary.language,
            posts_text=posts_text,
        )
        start = time.perf_counter()
        result = await provider.complete(prompt, model=model, temperature=0.7)
        duration = time.perf_counter() - start
        full_text = result.text
        upsert_llm_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "model": model,
                "prompt": prompt,
                "response": full_text,
                "model_config_json": {"temperature": 0.7},
                "full_request": {"contents": [{"parts": [{"text": prompt}]}]},
                "full_response": result.model_dump(),
                "status": "success",
                "timestamp": int(time.time() * 1000),
                "duration": duration,
                "type": "summary",
            },
            owner_id,
        )

    cited = _extract_cited_posts(full_text, posts)
    new_id = str(int(time.time() * 1000))
    new_extra = {
        **{k: v for k, v in extra.items() if k not in ("autoRegenerate",)},
        "autoRegenerate": True,
        "autoPublish": extra.get("autoPublish"),
        "publishBotId": extra.get("publishBotId"),
        "publishChatId": extra.get("publishChatId"),
        "sendMetadata": extra.get("sendMetadata", True),
        "metadataText": extra.get("metadataText"),
        "postSearch": extra.get("postSearch"),
        "semanticSearchQuery": extra.get("semanticSearchQuery"),
        "semanticSearchRespectsTimeRange": extra.get("semanticSearchRespectsTimeRange"),
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
            logger.exception("Auto-summary failed for %s", summary.id)
            err = str(exc)
            errors.append(f"{summary.id}: {err}")
            if "quota" in err.lower() or "429" in err or "rate limit" in err.lower():
                with Session(engine) as session:
                    row = session.get(Summary, summary.id)
                    if row:
                        row.extra = {**_summary_extra(row), "autoRegenerate": False}
                        session.add(row)
                        session.commit()
                        touch_sync(session, "summaries")
        finally:
            _regenerating.discard(summary.id)

    return {"regenerated": regenerated, "errors": errors}
