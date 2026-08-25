"""Camel/snake normalization and TG API response serializers."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from app.models_tg import (
    BotCredential,
    Channel,
    ChannelFollow,
    ChannelSettingGroup,
    ChatDestination,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    SyncLog,
    SyncLogPayload,
)
from app.services.channel_photos import channel_photo_api_path, has_cached_photo
from app.services.channel_tags import normalize_channel_tags

_CAMEL_OVERRIDES = {
    "display_name": "displayName",
    "photo_url": "photoUrl",
    "start_id": "startId",
    "start_time": "startTime",
    "last_updated": "lastUpdated",
    "setting_group_id": "settingGroupId",
    "setting_group_name": "settingGroupName",
    "dynamic_sync_enabled": "dynamicSyncEnabled",
    "auto_sync_interval_minutes": "autoSyncIntervalMinutes",
    "dynamic_sync_expected_posts": "dynamicSyncExpectedPosts",
    "next_regular_sync_at": "nextRegularSyncAt",
    "next_dynamic_sync_at": "nextDynamicSyncAt",
    "is_frozen": "isFrozen",
    "is_unavailable_on_web_view": "isUnavailableOnWebView",
    "auto_follow_forwarded": "autoFollowForwarded",
    "followed_at": "followedAt",
    "telegram_chat_id": "telegramChatId",
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


def mapping_to_camel(
    data: Mapping[str, Any], *, skip: frozenset[str] = frozenset()
) -> dict[str, Any]:
    """Camelise a column-name -> value mapping, dropping the bookkeeping keys.

    Split out of `model_to_camel` so a **column select** can be serialised
    without an ORM entity. The log list projection selects only its light
    columns, and there is no model instance to dump — see
    `services/logs.py::_light_columns` for why deferring on the entity was the
    wrong tool.

    `id` is skipped here as it is in `model_to_camel`; every log serialiser puts
    it back first so it leads the payload.
    """
    result: dict[str, Any] = {}
    for key, value in data.items():
        if key in skip or key in ("id", "user_id", "updated_at"):
            continue
        camel = to_camel(key)
        if isinstance(value, uuid.UUID):
            value = str(value)
        result[camel] = value
    return result


def model_to_camel(row: Any, *, skip: frozenset[str] = frozenset()) -> dict[str, Any]:
    return mapping_to_camel(row.model_dump(), skip=skip)


def channel_to_camel(
    ch: Channel,
    *,
    group: ChannelSettingGroup | None = None,
    follow: ChannelFollow | None = None,
) -> dict[str, Any]:
    """Build one channel's payload.

    `follow` is the caller's `ChannelFollow` row for this channel, when the
    caller has one (ticket 15). `tags`, `startId`, `startTime`, `followedAt`
    and `discoveredVia` are the per-User columns ticket 04 copied onto
    `ChannelFollow` and ticket 22 drops from `Channel` — while both tables
    carry them, the Follow is the one to read, because it is the copy a second
    follower of the same handle can have its own values in. `Channel`'s own
    values are the fallback for a channel nobody has a Follow row for yet
    (pre-backfill, or the flag-off callers that still pass none), so this never
    turns a present value into a missing one.
    """
    from app.services.channel_setting_groups import effective_channel_fields

    photo_url = ch.photo_url
    if has_cached_photo(ch.id):
        photo_url = channel_photo_api_path(ch.id)
    row = {
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
        "startId": follow.start_id if follow is not None else ch.start_id,
        "startTime": follow.start_time if follow is not None else ch.start_time,
        "tags": normalize_channel_tags(follow.tags if follow is not None else ch.tags),
        "lastUpdated": ch.last_updated,
        "nextRegularSyncAt": ch.next_regular_sync_at,
        "nextDynamicSyncAt": ch.next_dynamic_sync_at,
        "language": ch.language,
        "followedAt": follow.followed_at if follow is not None else ch.followed_at,
        "telegramChatId": ch.telegram_chat_id,
        "discoveredVia": (
            follow.discovered_via if follow is not None else ch.discovered_via
        ),
        "historyCompleteToCutoff": ch.history_complete_to_cutoff,
        "historyReachedChannelStart": ch.history_reached_channel_start,
        "anchorPostId": ch.anchor_post_id,
        "oldestStoredPostTimestamp": ch.oldest_stored_post_timestamp,
    }
    if group is not None:
        row.update(effective_channel_fields(group))
    return row


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
        "media": p.media,
        "links": p.links,
        "replyToPostId": p.reply_to_post_id,
        "replyTo": p.reply_to,
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


def sync_log_to_camel(
    log: SyncLog, payload: SyncLogPayload | None = None
) -> dict[str, Any]:
    """Serialise a sync log with its (optional) payload row folded back in.

    The bodies moved to tg_sync_log_payloads, but the wire shape did not change:
    they are re-emitted here, and stay null when the payload has been reclaimed.
    """
    return {
        "id": log.id,
        **model_to_camel(log),
        "fullRequest": payload.full_request if payload else None,
        "fullResponse": payload.full_response if payload else None,
    }


def llm_log_to_camel(log: LLMLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}


def embedding_log_to_camel(log: EmbeddingLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}


def network_log_to_camel(log: NetworkLog) -> dict[str, Any]:
    return {"id": log.id, **model_to_camel(log)}
