"""Auto-regenerate and auto-publish summaries (DECISION #6)."""

from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import datetime

from sqlmodel import Session, col, or_, select

from app.ai.registry import default_model, get_provider
from app.services.logs import upsert_llm_log, upsert_publish_log
from app.services.operator import get_operator_user_id, select_operator_channels
from app.services.sync_meta import touch_sync
from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel, ChatDestination, Post, Summary
from app.prompts.templates import SYSTEM_PROMPT
from app.services.publish import publish_summary_text
from app.services.network_settings import load_network_settings, resolve_proxies
from app.services.scraper_jobs import create_job, has_active_sync_job
from app.services.sync_orchestrator import run_sync_job

logger = logging.getLogger(__name__)

RTL_LANGUAGES = {"Persian", "Arabic", "فارسی", "العربية"}
_regenerating: set[str] = set()
_CITATION_RE = re.compile(r"\[([^\]]+?)\s*#(\d+)\]")


def _rtl(language: str) -> str:
    if language in RTL_LANGUAGES:
        return (
            "IMPORTANT: Since this is a Right-to-Left (RTL) language, ensure the entire "
            "summary is formatted correctly for RTL reading."
        )
    return ""


def _extract_cited_posts(text: str, posts: list[Post]) -> dict[str, dict]:
    cited: dict[str, dict] = {}
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


def _default_metadata(summary: Summary, extra: dict) -> str:
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


def _summary_extra(s: Summary) -> dict:
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
    operator_id,
) -> None:
    if has_active_sync_job():
        return
    operator_channels = {ch.name: ch for ch in select_operator_channels(session, operator_id=operator_id)}
    stale = []
    for name in channel_names:
        ch = operator_channels.get(name)
        if ch and not ch.is_frozen and (ch.last_updated or 0) < end_ts:
            stale.append(ch)
    if not stale:
        return
    job = await create_job(
        channel_entries=[(ch.id, ch.name) for ch in stale],
        source="Auto-Regenerate Summary (scheduler)",
        user_id=str(operator_id) if operator_id else None,
    )
    await run_sync_job(job, operator_id)


async def _regenerate_one(session: Session, summary: Summary) -> str | None:
    extra = _summary_extra(summary)
    duration_ms = summary.end_date - summary.start_date
    new_start = summary.end_date
    new_end = summary.end_date + duration_ms

    operator_id = summary.user_id or get_operator_user_id(session)
    await _sync_channels_for_summary(session, summary.channels or [], new_end, operator_id)

    posts = session.exec(
        select(Post)
        .where(
            col(Post.channel_name).in_(summary.channels or []),
            col(Post.timestamp) >= new_start,
            col(Post.timestamp) <= new_end,
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
        prompt = SYSTEM_PROMPT.format(
            channels=", ".join(summary.channels or []),
            language=summary.language,
            rtl_instruction=_rtl(summary.language),
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
            summary.user_id,
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
        "citedPosts": cited,
        "postCount": len(posts),
    }

    new_summary = Summary(
        id=new_id,
        user_id=summary.user_id,
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

    summary.extra = {**extra, "autoRegenerate": False}
    summary.updated_at = datetime.utcnow()
    session.add(summary)
    session.commit()
    touch_sync(session, "summaries")

    if extra.get("autoPublish") and extra.get("publishBotId") and extra.get("publishChatId") and posts:
        await _auto_publish(session, new_summary, new_extra, full_text)

    return new_id


async def _auto_publish(
    session: Session,
    summary: Summary,
    extra: dict,
    full_text: str,
) -> None:
    bot_id = str(extra.get("publishBotId"))
    chat_dest_id = str(extra.get("publishChatId"))
    dest = session.get(ChatDestination, chat_dest_id)
    if not dest:
        logger.warning("Chat destination %s not found for auto-publish", chat_dest_id)
        return

    network = load_network_settings(session, summary.user_id)
    proxies = resolve_proxies(network)
    metadata = None
    if extra.get("sendMetadata", True):
        metadata = extra.get("metadataText") or _default_metadata(summary, extra)

    try:
        result = await publish_summary_text(
            session,
            credential_id=bot_id,
            chat_id=dest.chat_id,
            text=full_text,
            metadata_text=metadata,
            proxies=proxies,
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
            summary.user_id,
        )
        session.commit()
        touch_sync(session, "publish_logs")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Auto-publish failed for summary %s", summary.id)
        upsert_publish_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "summary_id": summary.id,
                "bot_id": bot_id,
                "bot_name": bot_id,
                "chat_id": dest.chat_id,
                "chat_name": dest.name,
                "status": "failed",
                "error": str(exc),
                "timestamp": int(time.time() * 1000),
                "text_sent": full_text,
            },
            summary.user_id,
        )
        session.commit()
        touch_sync(session, "publish_logs")


async def run_auto_summary() -> dict:
    now = int(time.time() * 1000)
    regenerated: list[str] = []
    errors: list[str] = []

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        stmt = select(Summary)
        if operator_id is not None:
            stmt = stmt.where(
                or_(Summary.user_id == operator_id, col(Summary.user_id).is_(None))
            )
        summaries = session.exec(stmt).all()
        due = [s for s in summaries if _is_due(s, now) and s.id not in _regenerating]

    for summary in due:
        _regenerating.add(summary.id)
        try:
            with Session(engine) as session:
                row = session.get(Summary, summary.id)
                if not row or not _is_due(row, now):
                    continue
                new_id = await _regenerate_one(session, row)
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
