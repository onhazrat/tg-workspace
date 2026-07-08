"""IndexedDB export import and full data export (extracted from data routes)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from app.models_tg import (
    BotCredential,
    Channel,
    ChannelSettingGroup,
    ChatDestination,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    Summary,
    SyncLog,
)
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_or_create_restricted_group,
    load_groups_by_id,
    setting_group_to_camel,
)
from app.services.channel_tags import normalize_channel_tags
from app.services.channels import SERVER_MANAGED_CHANNEL_FIELDS, apply_channel_fields
from app.services.credentials import encrypt_bot_token
from app.services.logs import (
    upsert_embedding_log,
    upsert_llm_log,
    upsert_network_log,
    upsert_publish_log,
    upsert_sync_log,
)
from app.services.posts import bulk_upsert_posts_impl
from app.services.serialization import (
    bot_to_camel,
    channel_to_camel,
    chat_dest_to_camel,
    embedding_log_to_camel,
    embedding_to_camel,
    llm_log_to_camel,
    network_log_to_camel,
    normalize_body,
    post_to_camel,
    publish_log_to_camel,
    sync_log_to_camel,
    translation_to_camel,
)
from app.services.summaries import summary_to_camel
from app.services.sync_meta import touch_sync


def unwrap_import_body(body: dict[str, Any]) -> dict[str, Any]:
    if "data" in body and isinstance(body["data"], dict):
        inner = body["data"]
        if any(
            k in inner for k in ("channels", "posts", "summaries", "bot_credentials")
        ):
            return inner
    return body


def import_data(
    session: Session, body: dict[str, Any], *, user_id: uuid.UUID | None
) -> dict[str, Any]:
    """Import from IndexedDB export JSON structure."""
    payload = unwrap_import_body(body)
    counts: dict[str, int] = {}

    for item in payload.get("channels", []):
        normalized = normalize_body(item)
        for field in SERVER_MANAGED_CHANNEL_FIELDS:
            normalized.pop(field, None)
        channel_id = normalized.get("id", item.get("id"))
        ch = session.get(Channel, channel_id)
        if ch:
            apply_channel_fields(ch, normalized, session=session)
            ch.updated_at = datetime.utcnow()
        else:
            setting_group_id = normalized.get("setting_group_id")
            group = (
                session.get(ChannelSettingGroup, setting_group_id)
                if setting_group_id
                else None
            )
            if group is None:
                is_restricted = bool(
                    normalized.get("is_unavailable_on_web_view")
                    or normalized.get("is_frozen")
                )
                group = (
                    get_or_create_restricted_group(session, user_id=user_id)
                    if is_restricted
                    else ensure_default_group(session, user_id=user_id)
                )
            ch = Channel(
                id=channel_id,
                user_id=user_id,
                name=normalized.get("name", ""),
                display_name=normalized.get("display_name"),
                photo_url=normalized.get("photo_url"),
                bio=normalized.get("bio"),
                subscribers=normalized.get("subscribers"),
                photos=normalized.get("photos"),
                videos=normalized.get("videos"),
                files=normalized.get("files"),
                links=normalized.get("links"),
                start_id=normalized.get("start_id"),
                start_time=normalized.get("start_time"),
                tags=normalize_channel_tags(normalized.get("tags", [])),
                last_updated=normalized.get("last_updated"),
                setting_group_id=group.id,
                language=normalized.get("language"),
                followed_at=normalized.get("followed_at"),
                discovered_via=normalized.get("discovered_via"),
            )
        session.add(ch)
    if payload.get("channels"):
        counts["channels"] = len(payload["channels"])

    if payload.get("posts"):
        counts["posts"] = bulk_upsert_posts_impl(payload["posts"], session)

    for item in payload.get("summaries", []):
        sid = item.get("id")
        known_fields = {
            "text",
            "channels",
            "startDate",
            "endDate",
            "language",
            "model",
            "postCount",
            "timestamp",
        }
        summary = session.get(Summary, sid)
        if summary:
            summary.text = item.get("text", summary.text)
            summary.channels = item.get("channels", summary.channels)
            summary.start_date = item.get(
                "startDate", item.get("start_date", summary.start_date)
            )
            summary.end_date = item.get(
                "endDate", item.get("end_date", summary.end_date)
            )
            summary.language = item.get("language", summary.language)
            summary.model = item.get("model", summary.model)
            summary.post_count = item.get(
                "postCount", item.get("post_count", summary.post_count)
            )
            summary.timestamp = item.get("timestamp", summary.timestamp)
            summary.extra = {
                k: v for k, v in item.items() if k not in known_fields and k != "id"
            }
            summary.updated_at = datetime.utcnow()
        else:
            summary = Summary(
                id=sid,
                user_id=user_id,
                text=item.get("text", ""),
                channels=item.get("channels", []),
                start_date=item.get("startDate", item.get("start_date", 0)),
                end_date=item.get("endDate", item.get("end_date", 0)),
                language=item.get("language", "English"),
                model=item.get("model"),
                post_count=item.get("postCount", item.get("post_count")),
                timestamp=item.get("timestamp", 0),
                extra={k: v for k, v in item.items() if k not in known_fields},
            )
        session.add(summary)
    if payload.get("summaries"):
        counts["summaries"] = len(payload["summaries"])

    for item in payload.get("bot_credentials", []):
        normalized = normalize_body(item)
        bid = normalized.get("id", item.get("id"))
        token = normalized.get("token_encrypted") or normalized.get("token", "")
        encrypted = encrypt_bot_token(token) if token else ""
        bot = session.get(BotCredential, bid)
        if bot:
            bot.name = normalized.get("name", bot.name)
            if encrypted:
                bot.token_encrypted = encrypted
            bot.username = normalized.get("username", bot.username)
            bot.photo_url = normalized.get("photo_url", bot.photo_url)
            bot.last_validated = normalized.get("last_validated", bot.last_validated)
            bot.updated_at = datetime.utcnow()
        else:
            if not encrypted:
                continue
            bot = BotCredential(
                id=bid,
                user_id=user_id,
                name=normalized.get("name", bid),
                token_encrypted=encrypted,
                username=normalized.get("username"),
                photo_url=normalized.get("photo_url"),
                last_validated=normalized.get("last_validated"),
            )
        session.add(bot)
    if payload.get("bot_credentials"):
        counts["bot_credentials"] = len(payload["bot_credentials"])

    for item in payload.get("chat_destinations", []):
        normalized = normalize_body(item)
        did = normalized.get("id", item.get("id"))
        dest = session.get(ChatDestination, did)
        if dest:
            dest.name = normalized.get("name", dest.name)
            dest.chat_id = normalized.get("chat_id", dest.chat_id)
            dest.updated_at = datetime.utcnow()
        else:
            dest = ChatDestination(
                id=did,
                user_id=user_id,
                name=normalized.get("name", did),
                chat_id=normalized.get("chat_id", ""),
            )
        session.add(dest)
    if payload.get("chat_destinations"):
        counts["chat_destinations"] = len(payload["chat_destinations"])

    for store, upsert_fn, _sync_key in [
        ("publish_logs", upsert_publish_log, "publish_logs"),
        ("sync_logs", upsert_sync_log, "sync_logs"),
        ("llm_logs", upsert_llm_log, "llm_logs"),
        ("embedding_logs", upsert_embedding_log, "embedding_logs"),
        ("network_logs", upsert_network_log, "network_logs"),
    ]:
        items = payload.get(store, [])
        for item in items:
            upsert_fn(session, item, user_id)
        if items:
            counts[store] = len(items)

    for item in payload.get("embeddings", []):
        normalized = normalize_body(item)
        eid = normalized.get("id", item.get("id"))
        session.merge(
            PostEmbedding(
                id=eid,
                channel_name=normalized.get("channel_name", ""),
                post_id=int(normalized.get("post_id", 0)),
                vector=normalized.get("vector", []),
                text=normalized.get("text", ""),
                provider=normalized.get("provider", "gemini"),
                model=normalized.get("model", ""),
                dimensions=normalized.get("dimensions", 0),
            )
        )
    if payload.get("embeddings"):
        counts["embeddings"] = len(payload["embeddings"])

    for item in payload.get("translations", []):
        normalized = normalize_body(item)
        tid = normalized.get("id", item.get("id"))
        session.merge(
            PostTranslation(
                id=tid,
                channel_name=normalized.get("channel_name", ""),
                post_id=int(normalized.get("post_id", 0)),
                language=normalized.get("language", ""),
                translated_text=normalized.get("translated_text", ""),
                timestamp=normalized.get("timestamp", 0),
            )
        )
    if payload.get("translations"):
        counts["translations"] = len(payload["translations"])

    session.commit()
    for key in counts:
        touch_sync(session, key)
    return {"imported": counts}


def export_data(session: Session) -> dict[str, Any]:
    groups_by_id = load_groups_by_id(session)
    channels = session.exec(select(Channel)).all()
    return {
        "version": 2,
        "timestamp": int(datetime.utcnow().timestamp() * 1000),
        "data": {
            "setting_groups": [
                setting_group_to_camel(group) for group in groups_by_id.values()
            ],
            "channels": [
                channel_to_camel(
                    channel, group=groups_by_id.get(channel.setting_group_id)
                )
                for channel in channels
            ],
            "posts": [post_to_camel(p) for p in session.exec(select(Post)).all()],
            "summaries": [
                summary_to_camel(s) for s in session.exec(select(Summary)).all()
            ],
            "bot_credentials": [
                bot_to_camel(b) for b in session.exec(select(BotCredential)).all()
            ],
            "chat_destinations": [
                chat_dest_to_camel(d)
                for d in session.exec(select(ChatDestination)).all()
            ],
            "publish_logs": [
                publish_log_to_camel(log)
                for log in session.exec(select(PublishLog)).all()
            ],
            "sync_logs": [
                sync_log_to_camel(log) for log in session.exec(select(SyncLog)).all()
            ],
            "llm_logs": [
                llm_log_to_camel(log) for log in session.exec(select(LLMLog)).all()
            ],
            "embedding_logs": [
                embedding_log_to_camel(log)
                for log in session.exec(select(EmbeddingLog)).all()
            ],
            "network_logs": [
                network_log_to_camel(log)
                for log in session.exec(select(NetworkLog)).all()
            ],
            "embeddings": [
                embedding_to_camel(e) for e in session.exec(select(PostEmbedding)).all()
            ],
            "translations": [
                translation_to_camel(t)
                for t in session.exec(select(PostTranslation)).all()
            ],
        },
    }
