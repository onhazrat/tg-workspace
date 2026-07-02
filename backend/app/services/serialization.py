"""Camel/snake normalization and TG API response serializers."""

from __future__ import annotations

import uuid
from typing import Any

from app.models_tg import (
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
    SyncLog,
)
from app.services.channel_tags import normalize_channel_tags
from app.services.channel_photos import channel_photo_api_path, has_cached_photo

_CAMEL_OVERRIDES = {
    "display_name": "displayName",
    "photo_url": "photoUrl",
    "start_id": "startId",
    "start_time": "startTime",
    "last_updated": "lastUpdated",
    "regular_sync_enabled": "regularSyncEnabled",
    "dynamic_sync_enabled": "dynamicSyncEnabled",
    "auto_sync_interval_minutes": "autoSyncIntervalMinutes",
    "dynamic_sync_expected_posts": "dynamicSyncExpectedPosts",
    "next_regular_sync_at": "nextRegularSyncAt",
    "next_dynamic_sync_at": "nextDynamicSyncAt",
    "is_frozen": "isFrozen",
    "is_unavailable_on_web_view": "isUnavailableOnWebView",
    "auto_follow_forwarded": "autoFollowForwarded",
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


def to_snake(key: str) -> str:
    if key in _REVERSE_OVERRIDES:
        return _REVERSE_OVERRIDES[key]
    out: list[str] = []
    for i, ch in enumerate(key):
        if ch.isupper() and i > 0:
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def to_camel(key: str) -> str:
    if key in _CAMEL_OVERRIDES:
        return _CAMEL_OVERRIDES[key]
    parts = key.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def normalize_body(body: dict[str, Any]) -> dict[str, Any]:
    return {to_snake(k): v for k, v in body.items()}


def model_to_camel(row: Any, *, skip: frozenset[str] = frozenset()) -> dict[str, Any]:
    data = row.model_dump()
    result: dict[str, Any] = {}
    for key, value in data.items():
        if key in skip or key in ("id", "user_id", "updated_at"):
            continue
        camel = to_camel(key)
        if isinstance(value, uuid.UUID):
            value = str(value)
        result[camel] = value
    return result


def channel_to_camel(ch: Channel) -> dict[str, Any]:
    photo_url = ch.photo_url
    if has_cached_photo(ch.id):
        photo_url = channel_photo_api_path(ch.id)
    return {
        "id": ch.id,
        "name": ch.name,
        "displayName": ch.display_name,
        "photoUrl": photo_url,
        "bio": ch.bio,
        "subscribers": ch.subscribers,
        "photos": ch.photos,
        "videos": ch.videos,
        "files": ch.files,
        "links": ch.links,
        "startId": ch.start_id,
        "startTime": ch.start_time,
        "tags": normalize_channel_tags(ch.tags),
        "lastUpdated": ch.last_updated,
        "regularSyncEnabled": ch.regular_sync_enabled,
        "dynamicSyncEnabled": ch.dynamic_sync_enabled,
        "autoSyncIntervalMinutes": ch.auto_sync_interval_minutes,
        "dynamicSyncExpectedPosts": ch.dynamic_sync_expected_posts,
        "nextRegularSyncAt": ch.next_regular_sync_at,
        "nextDynamicSyncAt": ch.next_dynamic_sync_at,
        "isFrozen": ch.is_frozen,
        "isUnavailableOnWebView": ch.is_unavailable_on_web_view,
        "autoFollowForwarded": ch.auto_follow_forwarded,
        "language": ch.language,
        "followedAt": ch.followed_at,
        "discoveredVia": ch.discovered_via,
        "historyCompleteToCutoff": ch.history_complete_to_cutoff,
        "anchorPostId": ch.anchor_post_id,
        "oldestStoredPostTimestamp": ch.oldest_stored_post_timestamp,
    }


def post_to_camel(p: Post) -> dict[str, Any]:
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


def bot_to_camel(b: BotCredential) -> dict[str, Any]:
    return {
        "id": b.id,
        "name": b.name,
        "hasToken": bool(b.token_encrypted),
        "username": b.username,
        "photoUrl": b.photo_url,
        "lastValidated": b.last_validated,
    }


def chat_dest_to_camel(d: ChatDestination) -> dict[str, Any]:
    return {"id": d.id, "name": d.name, "chatId": d.chat_id}


def embedding_to_camel(e: PostEmbedding) -> dict[str, Any]:
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


def translation_to_camel(t: PostTranslation) -> dict[str, Any]:
    return {
        "id": t.id,
        "channelName": t.channel_name,
        "postId": t.post_id,
        "language": t.language,
        "translatedText": t.translated_text,
        "timestamp": t.timestamp,
    }


def publish_log_to_camel(log: PublishLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}


def sync_log_to_camel(log: SyncLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}


def llm_log_to_camel(log: LLMLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}


def embedding_log_to_camel(log: EmbeddingLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}


def network_log_to_camel(log: NetworkLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}
