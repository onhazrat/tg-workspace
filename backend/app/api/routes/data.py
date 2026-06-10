"""CRUD and sync APIs for TG Summarizer data."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from app.api.deps import CurrentUser, SessionDep
from app.core.secrets import encrypt_token, is_encrypted
from app.services.bulk_channels import bulk_reresolve_start_ids, bulk_reset_and_queue_sync
from app.services.channels import compute_channel_stats, compute_channel_stats_batch
from app.services.operator import get_operator_user_id
from app.services.logs import (
    LOG_MODELS,
    clear_logs,
    delete_log_by_id,
    delete_old_logs,
    upsert_embedding_log,
    upsert_llm_log,
    upsert_network_log,
    upsert_publish_log,
    upsert_sync_log,
)
from app.services.network_settings import (
    get_network_setting_row,
    load_network_settings,
    merge_network_put,
    network_settings_payload,
)
from app.services.posts import bulk_upsert_posts_impl
from app.services.settings_store import get_app_setting, put_app_setting
from app.services.stats import get_db_stats
from app.services.summaries import (
    delete_summary as delete_summary_impl,
    list_summaries as list_summaries_impl,
    summary_to_camel,
    upsert_summary as upsert_summary_impl,
)
from app.services.sync_meta import touch_sync
from app.models_tg import (
    AppSetting,
    BotCredential,
    Channel,
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
    SyncMeta,
)

router = APIRouter(prefix="/data", tags=["data"])


class BulkReresolveStartIdsRequest(BaseModel):
    dry_run: bool = Field(default=False, alias="dryRun")
    limit: int | None = None
    channel_ids: list[str] | None = Field(default=None, alias="channelIds")
    auto_follow_only: bool = Field(default=False, alias="autoFollowOnly")

    model_config = {"populate_by_name": True}


class BulkResetSyncRequest(BaseModel):
    confirm: bool = False
    channel_ids: list[str] | None = Field(default=None, alias="channelIds")
    auto_follow_only: bool = Field(default=False, alias="autoFollowOnly")

    model_config = {"populate_by_name": True}

_CAMEL_OVERRIDES = {
    "display_name": "displayName",
    "photo_url": "photoUrl",
    "start_id": "startId",
    "start_time": "startTime",
    "last_updated": "lastUpdated",
    "is_frozen": "isFrozen",
    "is_unavailable_on_web_view": "isUnavailableOnWebView",
    "followed_at": "followedAt",
    "discovered_via": "discoveredVia",
    "channel_name": "channelName",
    "forwarded_from": "forwardedFrom",
    "forwarded_from_name": "forwardedFromName",
    "start_date": "startDate",
    "end_date": "endDate",
    "post_count": "postCount",
    "token_encrypted": "token",
    "chat_id": "chatId",
    "post_id": "postId",
    "translated_text": "translatedText",
    "last_validated": "lastValidated",
    "summary_id": "summaryId",
    "bot_id": "botId",
    "bot_name": "botName",
    "chat_name": "chatName",
    "text_sent": "textSent",
    "full_request": "fullRequest",
    "full_response": "fullResponse",
    "posts_count": "postsCount",
    "new_latest_id": "newLatestId",
    "system_instruction": "systemInstruction",
    "model_config_json": "modelConfig",
    "log_type": "type",
    "text_count": "textCount",
    "tokens_estimated": "tokensEstimated",
    "status_code": "statusCode",
    "proxy_used": "proxyUsed",
}

_REVERSE_OVERRIDES = {v: k for k, v in _CAMEL_OVERRIDES.items()}


def _to_snake(key: str) -> str:
    if key in _REVERSE_OVERRIDES:
        return _REVERSE_OVERRIDES[key]
    out: list[str] = []
    for i, ch in enumerate(key):
        if ch.isupper() and i > 0:
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def _to_camel(key: str) -> str:
    if key in _CAMEL_OVERRIDES:
        return _CAMEL_OVERRIDES[key]
    parts = key.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _normalize_body(body: dict[str, Any]) -> dict[str, Any]:
    return {_to_snake(k): v for k, v in body.items()}


def _model_to_camel(row: Any, *, skip: frozenset[str] = frozenset()) -> dict[str, Any]:
    data = row.model_dump()
    result: dict[str, Any] = {}
    for key, value in data.items():
        if key in skip or key in ("id", "user_id", "updated_at"):
            continue
        camel = _to_camel(key)
        if isinstance(value, uuid.UUID):
            value = str(value)
        result[camel] = value
    return result


def _channel_to_camel(ch: Channel) -> dict[str, Any]:
    return {
        "id": ch.id,
        "name": ch.name,
        "displayName": ch.display_name,
        "photoUrl": ch.photo_url,
        "bio": ch.bio,
        "subscribers": ch.subscribers,
        "photos": ch.photos,
        "videos": ch.videos,
        "files": ch.files,
        "links": ch.links,
        "startId": ch.start_id,
        "startTime": ch.start_time,
        "tags": ch.tags,
        "lastUpdated": ch.last_updated,
        "isFrozen": ch.is_frozen,
        "isUnavailableOnWebView": ch.is_unavailable_on_web_view,
        "language": ch.language,
        "followedAt": ch.followed_at,
        "discoveredVia": ch.discovered_via,
        "historyCompleteToCutoff": ch.history_complete_to_cutoff,
        "anchorPostId": ch.anchor_post_id,
        "oldestStoredPostTimestamp": ch.oldest_stored_post_timestamp,
    }


def _post_to_camel(p: Post) -> dict[str, Any]:
    return {
        "id": p.post_id,
        "channelName": p.channel_name,
        "text": p.text,
        "date": p.date,
        "timestamp": p.timestamp,
        "forwardedFrom": p.forwarded_from,
        "forwardedFromName": p.forwarded_from_name,
        "isAnchor": p.is_anchor,
        "retrievedAt": p.retrieved_at,
        "retrievalJobId": p.retrieval_job_id,
        "retrievalPass": p.retrieval_pass,
        "retrievalSource": p.retrieval_source,
    }


def _bot_to_camel(b: BotCredential) -> dict[str, Any]:
    return {
        "id": b.id,
        "name": b.name,
        "hasToken": bool(b.token_encrypted),
        "username": b.username,
        "photoUrl": b.photo_url,
        "lastValidated": b.last_validated,
    }


def _encrypt_bot_token(token: str) -> str:
    if not token:
        return ""
    if is_encrypted(token):
        return token
    return encrypt_token(token)


def _chat_dest_to_camel(d: ChatDestination) -> dict[str, Any]:
    return {"id": d.id, "name": d.name, "chatId": d.chat_id}


def _embedding_to_camel(e: PostEmbedding) -> dict[str, Any]:
    return {
        "id": e.id,
        "channelName": e.channel_name,
        "postId": e.post_id,
        "vector": e.vector,
        "text": e.text,
        "provider": e.provider,
        "model": e.model,
        "dimensions": e.dimensions,
    }


def _translation_to_camel(t: PostTranslation) -> dict[str, Any]:
    return {
        "id": t.id,
        "channelName": t.channel_name,
        "postId": t.post_id,
        "language": t.language,
        "translatedText": t.translated_text,
        "timestamp": t.timestamp,
    }


def _publish_log_to_camel(log: PublishLog) -> dict[str, Any]:
    return {"id": log.id, **_model_to_camel(log)}


def _sync_log_to_camel(log: SyncLog) -> dict[str, Any]:
    return {"id": log.id, **_model_to_camel(log)}


def _llm_log_to_camel(log: LLMLog) -> dict[str, Any]:
    return {"id": log.id, **_model_to_camel(log)}


def _embedding_log_to_camel(log: EmbeddingLog) -> dict[str, Any]:
    return {"id": log.id, **_model_to_camel(log)}


def _network_log_to_camel(log: NetworkLog) -> dict[str, Any]:
    return {"id": log.id, **_model_to_camel(log)}


def _apply_channel_fields(ch: Channel, body: dict[str, Any]) -> None:
    normalized = _normalize_body(body)
    for key, value in normalized.items():
        if key in Channel.model_fields and key not in ("id", "user_id"):
            setattr(ch, key, value)


def _touch_sync(session: Session, resource: str) -> None:
    """Backward-compatible alias; prefer app.services.sync_meta.touch_sync."""
    touch_sync(session, resource)


def _unwrap_import_body(body: dict[str, Any]) -> dict[str, Any]:
    if "data" in body and isinstance(body["data"], dict):
        inner = body["data"]
        if any(k in inner for k in ("channels", "posts", "summaries", "bot_credentials")):
            return inner
    return body


# --- routes ---


@router.get("/sync-meta")
def get_sync_meta(
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    rows = session.exec(select(SyncMeta)).all()
    return {r.resource: {"etag": r.etag, "updatedAt": r.updated_at.isoformat()} for r in rows}


@router.get("/channels")
def list_channels(
    session: SessionDep,
    current_user: CurrentUser,
    include_stats: bool = Query(False, alias="includeStats"),
) -> list[dict[str, Any]]:
    channels = session.exec(select(Channel)).all()
    stats_map: dict[str, dict[str, Any]] = {}
    if include_stats and channels:
        stats_map = compute_channel_stats_batch(session, [c.name for c in channels])
    result = []
    for ch in channels:
        row = _channel_to_camel(ch)
        if include_stats and ch.name in stats_map:
            row["stats"] = stats_map[ch.name]
        result.append(row)
    return result


@router.put("/channels/{channel_id}")
def upsert_channel(
    channel_id: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    normalized = _normalize_body(body)
    ch = session.get(Channel, channel_id)
    if ch:
        _apply_channel_fields(ch, normalized)
        ch.updated_at = datetime.utcnow()
    else:
        name = normalized.get("name", channel_id)
        extras = {
            k: v
            for k, v in normalized.items()
            if k in Channel.model_fields and k not in ("id", "name", "user_id")
        }
        ch = Channel(id=channel_id, name=name, user_id=current_user.id, **extras)
    session.add(ch)
    session.commit()
    session.refresh(ch)
    _touch_sync(session, "channels")
    return _channel_to_camel(ch)


@router.post("/channels/bulk-reresolve-start-ids")
async def bulk_reresolve_start_ids_endpoint(
    session: SessionDep,
    current_user: CurrentUser,
    body: BulkReresolveStartIdsRequest = Body(default_factory=BulkReresolveStartIdsRequest),
) -> dict[str, Any]:
    operator_id = current_user.id or get_operator_user_id(session)
    result = await bulk_reresolve_start_ids(
        session,
        operator_id=operator_id,
        dry_run=body.dry_run,
        limit=body.limit,
        channel_ids=body.channel_ids,
        auto_follow_only=body.auto_follow_only,
    )
    return {
        "updated": result.updated,
        "skipped": result.skipped,
        "wouldUpdate": result.would_update,
        "errors": result.errors,
        "deprecated": result.deprecated,
        "message": result.message,
    }


@router.post("/channels/bulk-reset-sync")
async def bulk_reset_sync_endpoint(
    session: SessionDep,
    current_user: CurrentUser,
    body: BulkResetSyncRequest = Body(...),
) -> dict[str, Any]:
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Set confirm=true to clear posts and queue sync for selected channels.",
        )
    operator_id = current_user.id or get_operator_user_id(session)
    result = await bulk_reset_and_queue_sync(
        session,
        operator_id=operator_id,
        channel_ids=body.channel_ids,
        auto_follow_only=body.auto_follow_only,
    )
    return {
        "channelsReset": result.channels_reset,
        "postsDeleted": result.posts_deleted,
        "jobId": result.job_id,
        "errors": result.errors,
    }


@router.delete("/channels/{channel_id}")
def delete_channel(
    channel_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, str]:
    ch = session.get(Channel, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    posts = session.exec(select(Post).where(Post.channel_name == ch.name)).all()
    for p in posts:
        session.delete(p)
    session.delete(ch)
    session.commit()
    _touch_sync(session, "channels")
    _touch_sync(session, "posts")
    return {"status": "deleted"}


@router.get("/channels/{channel_id}/stats")
def get_channel_stats(
    channel_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    ch = session.get(Channel, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    stats = compute_channel_stats(session, ch.name)
    if not stats:
        raise HTTPException(status_code=404, detail="No posts for channel")
    return stats


@router.get("/posts")
def list_posts(
    session: SessionDep,
    current_user: CurrentUser,
    channel_names: str | None = Query(None, alias="channelNames"),
    channel_name: str | None = Query(None, alias="channelName"),
    start_date: int | None = Query(None, alias="startDate"),
    end_date: int | None = Query(None, alias="endDate"),
) -> list[dict[str, Any]]:
    stmt = select(Post)
    names: list[str] = []
    if channel_names:
        names = [n.strip() for n in channel_names.split(",") if n.strip()]
    elif channel_name:
        names = [channel_name]
    if names:
        stmt = stmt.where(col(Post.channel_name).in_(names))
    if start_date is not None:
        stmt = stmt.where(Post.timestamp >= start_date)
    if end_date is not None:
        stmt = stmt.where(Post.timestamp <= end_date)
    posts = session.exec(stmt).all()
    return [_post_to_camel(p) for p in posts]


def _bulk_upsert_posts_impl(body: list[dict[str, Any]], session: Session) -> int:
    """Backward-compatible alias; prefer app.services.posts.bulk_upsert_posts_impl."""
    return bulk_upsert_posts_impl(body, session)


@router.post("/posts/bulk")
def bulk_upsert_posts(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    count = _bulk_upsert_posts_impl(body, session)
    session.commit()
    _touch_sync(session, "posts")
    return {"upserted": count}


@router.get("/summaries")
def list_summaries(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_summaries_impl(session)


@router.put("/summaries/{summary_id}")
def upsert_summary(
    summary_id: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    result = upsert_summary_impl(
        session, summary_id, body, user_id=current_user.id
    )
    _touch_sync(session, "summaries")
    return result


@router.delete("/summaries/{summary_id}")
def delete_summary(
    summary_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, str]:
    delete_summary_impl(session, summary_id)
    _touch_sync(session, "summaries")
    return {"status": "deleted"}


# --- bot credentials ---


@router.get("/bot-credentials")
def list_bot_credentials(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_bot_to_camel(b) for b in session.exec(select(BotCredential)).all()]


@router.put("/bot-credentials/{bot_id}")
def upsert_bot_credential(
    bot_id: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    normalized = _normalize_body(body)
    token = normalized.get("token_encrypted") or normalized.get("token", "")
    encrypted = _encrypt_bot_token(token) if token else ""
    b = session.get(BotCredential, bot_id)
    if b:
        b.name = normalized.get("name", b.name)
        if encrypted:
            b.token_encrypted = encrypted
        b.username = normalized.get("username", b.username)
        b.photo_url = normalized.get("photo_url", b.photo_url)
        b.last_validated = normalized.get("last_validated", b.last_validated)
        b.updated_at = datetime.utcnow()
    else:
        if not encrypted:
            raise HTTPException(status_code=400, detail="token is required for new bot credentials")
        b = BotCredential(
            id=bot_id,
            user_id=current_user.id,
            name=normalized.get("name", bot_id),
            token_encrypted=encrypted,
            username=normalized.get("username"),
            photo_url=normalized.get("photo_url"),
            last_validated=normalized.get("last_validated"),
        )
    session.add(b)
    session.commit()
    session.refresh(b)
    _touch_sync(session, "bot_credentials")
    return _bot_to_camel(b)


@router.delete("/bot-credentials/{bot_id}")
def delete_bot_credential(
    bot_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, str]:
    b = session.get(BotCredential, bot_id)
    if not b:
        raise HTTPException(status_code=404, detail="Bot credential not found")
    session.delete(b)
    session.commit()
    _touch_sync(session, "bot_credentials")
    return {"status": "deleted"}


@router.post("/bot-credentials/migrate")
def migrate_bot_credentials(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    migrated: list[str] = []
    for item in body:
        normalized = _normalize_body(item)
        bid = normalized.get("id", item.get("id"))
        if not bid:
            continue
        token = normalized.get("token_encrypted") or normalized.get("token", "")
        if not token:
            continue
        encrypted = _encrypt_bot_token(token)
        b = session.get(BotCredential, bid)
        if b:
            b.name = normalized.get("name", b.name)
            b.token_encrypted = encrypted
            b.username = normalized.get("username", b.username)
            b.photo_url = normalized.get("photo_url", b.photo_url)
            b.last_validated = normalized.get("last_validated", b.last_validated)
            b.updated_at = datetime.utcnow()
        else:
            b = BotCredential(
                id=bid,
                user_id=current_user.id,
                name=normalized.get("name", bid),
                token_encrypted=encrypted,
                username=normalized.get("username"),
                photo_url=normalized.get("photo_url"),
                last_validated=normalized.get("last_validated"),
            )
        session.add(b)
        migrated.append(bid)
    session.commit()
    _touch_sync(session, "bot_credentials")
    return {"migrated": len(migrated), "ids": migrated}


# --- chat destinations ---


@router.get("/chat-destinations")
def list_chat_destinations(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_chat_dest_to_camel(d) for d in session.exec(select(ChatDestination)).all()]


@router.put("/chat-destinations/{dest_id}")
def upsert_chat_destination(
    dest_id: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    normalized = _normalize_body(body)
    d = session.get(ChatDestination, dest_id)
    if d:
        d.name = normalized.get("name", d.name)
        d.chat_id = normalized.get("chat_id", d.chat_id)
        d.updated_at = datetime.utcnow()
    else:
        d = ChatDestination(
            id=dest_id,
            user_id=current_user.id,
            name=normalized.get("name", dest_id),
            chat_id=normalized.get("chat_id", ""),
        )
    session.add(d)
    session.commit()
    session.refresh(d)
    _touch_sync(session, "chat_destinations")
    return _chat_dest_to_camel(d)


@router.delete("/chat-destinations/{dest_id}")
def delete_chat_destination(
    dest_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, str]:
    d = session.get(ChatDestination, dest_id)
    if not d:
        raise HTTPException(status_code=404, detail="Chat destination not found")
    session.delete(d)
    session.commit()
    _touch_sync(session, "chat_destinations")
    return {"status": "deleted"}


# --- embeddings ---


@router.get("/embeddings")
def list_embeddings(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_embedding_to_camel(e) for e in session.exec(select(PostEmbedding)).all()]


@router.post("/embeddings")
def upsert_embeddings(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    count = 0
    for item in body:
        eid = item.get("id", "")
        normalized = _normalize_body(item)
        existing = session.get(PostEmbedding, eid) if eid else None
        if existing:
            existing.channel_name = normalized.get("channel_name", existing.channel_name)
            existing.post_id = normalized.get("post_id", existing.post_id)
            existing.vector = normalized.get("vector", existing.vector)
            existing.text = normalized.get("text", existing.text)
            existing.provider = normalized.get("provider", existing.provider)
            existing.model = normalized.get("model", existing.model)
            existing.dimensions = normalized.get("dimensions", existing.dimensions)
            existing.updated_at = datetime.utcnow()
            session.add(existing)
        else:
            session.add(
                PostEmbedding(
                    id=eid or f"{normalized.get('channel_name')}_{normalized.get('post_id')}",
                    channel_name=normalized.get("channel_name", ""),
                    post_id=int(normalized.get("post_id", 0)),
                    vector=normalized.get("vector", []),
                    text=normalized.get("text", ""),
                    provider=normalized.get("provider", "gemini"),
                    model=normalized.get("model", ""),
                    dimensions=normalized.get("dimensions", 0),
                )
            )
        count += 1
    session.commit()
    _touch_sync(session, "embeddings")
    return {"upserted": count}


# --- translations ---


@router.get("/translations")
def list_translations(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_translation_to_camel(t) for t in session.exec(select(PostTranslation)).all()]


@router.post("/translations")
def upsert_translations(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    count = 0
    for item in body:
        tid = item.get("id", "")
        normalized = _normalize_body(item)
        existing = session.get(PostTranslation, tid) if tid else None
        if existing:
            existing.translated_text = normalized.get("translated_text", existing.translated_text)
            existing.timestamp = normalized.get("timestamp", existing.timestamp)
            existing.updated_at = datetime.utcnow()
            session.add(existing)
        else:
            session.add(
                PostTranslation(
                    id=tid
                    or f"{normalized.get('channel_name')}_{normalized.get('post_id')}_{normalized.get('language')}",
                    channel_name=normalized.get("channel_name", ""),
                    post_id=int(normalized.get("post_id", 0)),
                    language=normalized.get("language", ""),
                    translated_text=normalized.get("translated_text", ""),
                    timestamp=normalized.get("timestamp", 0),
                )
            )
        count += 1
    session.commit()
    _touch_sync(session, "translations")
    return {"upserted": count}


# --- logs ---


def _upsert_publish_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    upsert_publish_log(session, item, user_id)


def _upsert_sync_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    upsert_sync_log(session, item, user_id)


def _upsert_llm_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    upsert_llm_log(session, item, user_id)


def _upsert_embedding_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    upsert_embedding_log(session, item, user_id)


def _upsert_network_log(
    session: Session, item: dict[str, Any], user_id: uuid.UUID | None = None
) -> None:
    upsert_network_log(session, item, user_id)


@router.get("/publish-logs")
def list_publish_logs(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_publish_log_to_camel(l) for l in session.exec(select(PublishLog)).all()]


@router.post("/publish-logs")
def create_publish_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    for item in body:
        _upsert_publish_log(session, item, current_user.id)
    session.commit()
    _touch_sync(session, "publish_logs")
    return {"upserted": len(body)}


@router.get("/sync-logs")
def list_sync_logs(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_sync_log_to_camel(l) for l in session.exec(select(SyncLog)).all()]


@router.post("/sync-logs")
def create_sync_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    for item in body:
        _upsert_sync_log(session, item, current_user.id)
    session.commit()
    _touch_sync(session, "sync_logs")
    return {"upserted": len(body)}


@router.get("/llm-logs")
def list_llm_logs(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_llm_log_to_camel(l) for l in session.exec(select(LLMLog)).all()]


@router.post("/llm-logs")
def create_llm_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    for item in body:
        _upsert_llm_log(session, item, current_user.id)
    session.commit()
    _touch_sync(session, "llm_logs")
    return {"upserted": len(body)}


@router.get("/embedding-logs")
def list_embedding_logs(
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any] | list[dict[str, Any]]:
    return [_embedding_log_to_camel(l) for l in session.exec(select(EmbeddingLog)).all()]


@router.post("/embedding-logs")
def create_embedding_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    for item in body:
        _upsert_embedding_log(session, item, current_user.id)
    session.commit()
    _touch_sync(session, "embedding_logs")
    return {"upserted": len(body)}


@router.get("/network-logs")
def list_network_logs(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return [_network_log_to_camel(l) for l in session.exec(select(NetworkLog)).all()]


@router.post("/network-logs")
def create_network_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    for item in body:
        _upsert_network_log(session, item, current_user.id)
    session.commit()
    _touch_sync(session, "network_logs")
    return {"upserted": len(body)}


@router.get("/stats")
def db_stats(
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    return get_db_stats(session, operator_id=current_user.id)


@router.delete("/logs")
def purge_logs(
    session: SessionDep,
    current_user: CurrentUser,
    older_than_days: int | None = Query(default=None, alias="olderThanDays"),
    log_type: str | None = Query(default=None, alias="type"),
    log_id: str | None = Query(default=None, alias="logId"),
    clear_all: bool = Query(default=False, alias="clearAll"),
) -> dict[str, Any]:
    if older_than_days is not None and older_than_days > 0:
        deleted = delete_old_logs(session, older_than_days, operator_id=current_user.id)
        for resource in {LOG_MODELS[k][1] for k in deleted if deleted[k]}:
            _touch_sync(session, resource)
        return {"deleted": deleted, "total": sum(deleted.values())}

    if log_type is None:
        raise HTTPException(
            status_code=400,
            detail="Provide olderThanDays, or type with logId/clearAll",
        )
    if log_type not in LOG_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown log type: {log_type}")

    resource = LOG_MODELS[log_type][1]
    if log_id:
        if not delete_log_by_id(session, log_type, log_id):
            raise HTTPException(status_code=404, detail="Log entry not found")
        _touch_sync(session, resource)
        return {"deleted": 1}

    if clear_all:
        count = clear_logs(session, log_type)
        if count:
            _touch_sync(session, resource)
        return {"deleted": count}

    raise HTTPException(
        status_code=400,
        detail="Provide logId or clearAll=true with type",
    )


# --- settings ---


@router.get("/settings/network")
def get_network_settings(
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    value = network_settings_payload(
        row.value if row else None,
        owner_user_id=row.user_id if row else current_user.id,
    )
    return {"key": "network", "value": value}


@router.put("/settings/network")
def put_network_settings(
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    merged = merge_network_put(body, row.value if row else None)
    if row:
        row.value = merged
        row.user_id = current_user.id
        row.updated_at = datetime.utcnow()
    else:
        row = AppSetting(key="network", value=merged, user_id=current_user.id)
    session.add(row)
    session.commit()
    _touch_sync(session, "settings")
    return {
        "key": "network",
        "value": network_settings_payload(merged, owner_user_id=current_user.id),
    }


@router.get("/settings/{key}")
def get_setting(
    key: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    return get_app_setting(session, key)


@router.put("/settings/{key}")
def put_setting(
    key: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    result = put_app_setting(session, key, body, user_id=current_user.id)
    _touch_sync(session, "settings")
    return result


# --- import / export ---


@router.post("/import")
def import_data(
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    """Import from IndexedDB export JSON structure."""
    payload = _unwrap_import_body(body)
    counts: dict[str, int] = {}

    for item in payload.get("channels", []):
        normalized = _normalize_body(item)
        ch = session.get(Channel, normalized.get("id", item.get("id")))
        if ch:
            _apply_channel_fields(ch, normalized)
            ch.updated_at = datetime.utcnow()
        else:
            ch = Channel(
                id=normalized.get("id", item.get("id")),
                user_id=current_user.id,
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
                tags=normalized.get("tags", []),
                last_updated=normalized.get("last_updated"),
                is_frozen=normalized.get("is_frozen", False),
                is_unavailable_on_web_view=normalized.get("is_unavailable_on_web_view", False),
                language=normalized.get("language"),
                followed_at=normalized.get("followed_at"),
                discovered_via=normalized.get("discovered_via"),
            )
        session.add(ch)
    if payload.get("channels"):
        counts["channels"] = len(payload["channels"])

    if payload.get("posts"):
        counts["posts"] = _bulk_upsert_posts_impl(payload["posts"], session)

    for item in payload.get("summaries", []):
        sid = item.get("id")
        known_fields = {"text", "channels", "startDate", "endDate", "language", "model", "postCount", "timestamp"}
        s = session.get(Summary, sid)
        if s:
            s.text = item.get("text", s.text)
            s.channels = item.get("channels", s.channels)
            s.start_date = item.get("startDate", item.get("start_date", s.start_date))
            s.end_date = item.get("endDate", item.get("end_date", s.end_date))
            s.language = item.get("language", s.language)
            s.model = item.get("model", s.model)
            s.post_count = item.get("postCount", item.get("post_count", s.post_count))
            s.timestamp = item.get("timestamp", s.timestamp)
            s.extra = {k: v for k, v in item.items() if k not in known_fields and k != "id"}
            s.updated_at = datetime.utcnow()
        else:
            s = Summary(
                id=sid,
                user_id=current_user.id,
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
        session.add(s)
    if payload.get("summaries"):
        counts["summaries"] = len(payload["summaries"])

    for item in payload.get("bot_credentials", []):
        normalized = _normalize_body(item)
        bid = normalized.get("id", item.get("id"))
        token = normalized.get("token_encrypted") or normalized.get("token", "")
        encrypted = _encrypt_bot_token(token) if token else ""
        b = session.get(BotCredential, bid)
        if b:
            b.name = normalized.get("name", b.name)
            if encrypted:
                b.token_encrypted = encrypted
            b.username = normalized.get("username", b.username)
            b.photo_url = normalized.get("photo_url", b.photo_url)
            b.last_validated = normalized.get("last_validated", b.last_validated)
            b.updated_at = datetime.utcnow()
        else:
            if not encrypted:
                continue
            b = BotCredential(
                id=bid,
                user_id=current_user.id,
                name=normalized.get("name", bid),
                token_encrypted=encrypted,
                username=normalized.get("username"),
                photo_url=normalized.get("photo_url"),
                last_validated=normalized.get("last_validated"),
            )
        session.add(b)
    if payload.get("bot_credentials"):
        counts["bot_credentials"] = len(payload["bot_credentials"])

    for item in payload.get("chat_destinations", []):
        normalized = _normalize_body(item)
        did = normalized.get("id", item.get("id"))
        d = session.get(ChatDestination, did)
        if d:
            d.name = normalized.get("name", d.name)
            d.chat_id = normalized.get("chat_id", d.chat_id)
            d.updated_at = datetime.utcnow()
        else:
            d = ChatDestination(
                id=did,
                user_id=current_user.id,
                name=normalized.get("name", did),
                chat_id=normalized.get("chat_id", ""),
            )
        session.add(d)
    if payload.get("chat_destinations"):
        counts["chat_destinations"] = len(payload["chat_destinations"])

    for store, upsert_fn, sync_key in [
        ("publish_logs", _upsert_publish_log, "publish_logs"),
        ("sync_logs", _upsert_sync_log, "sync_logs"),
        ("llm_logs", _upsert_llm_log, "llm_logs"),
        ("embedding_logs", _upsert_embedding_log, "embedding_logs"),
        ("network_logs", _upsert_network_log, "network_logs"),
    ]:
        items = payload.get(store, [])
        for item in items:
            upsert_fn(session, item, current_user.id)
        if items:
            counts[store] = len(items)

    for item in payload.get("embeddings", []):
        normalized = _normalize_body(item)
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
        normalized = _normalize_body(item)
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
        _touch_sync(session, key)
    return {"imported": counts}


@router.get("/export")
def export_data(
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
    return {
        "version": 2,
        "timestamp": int(datetime.utcnow().timestamp() * 1000),
        "data": {
            "channels": [_channel_to_camel(c) for c in session.exec(select(Channel)).all()],
            "posts": [_post_to_camel(p) for p in session.exec(select(Post)).all()],
            "summaries": [summary_to_camel(s) for s in session.exec(select(Summary)).all()],
            "bot_credentials": [_bot_to_camel(b) for b in session.exec(select(BotCredential)).all()],
            "chat_destinations": [
                _chat_dest_to_camel(d) for d in session.exec(select(ChatDestination)).all()
            ],
            "publish_logs": [_publish_log_to_camel(l) for l in session.exec(select(PublishLog)).all()],
            "sync_logs": [_sync_log_to_camel(l) for l in session.exec(select(SyncLog)).all()],
            "llm_logs": [_llm_log_to_camel(l) for l in session.exec(select(LLMLog)).all()],
            "embedding_logs": [
                _embedding_log_to_camel(l) for l in session.exec(select(EmbeddingLog)).all()
            ],
            "network_logs": [_network_log_to_camel(l) for l in session.exec(select(NetworkLog)).all()],
            "embeddings": [_embedding_to_camel(e) for e in session.exec(select(PostEmbedding)).all()],
            "translations": [
                _translation_to_camel(t) for t in session.exec(select(PostTranslation)).all()
            ],
        },
    }
