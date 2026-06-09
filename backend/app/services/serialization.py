"""Camel/snake normalization for TG API payloads."""

from __future__ import annotations

from typing import Any

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


def to_snake(key: str) -> str:
    if key in _REVERSE_OVERRIDES:
        return _REVERSE_OVERRIDES[key]
    out: list[str] = []
    for i, ch in enumerate(key):
        if ch.isupper() and i > 0:
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def normalize_body(body: dict[str, Any]) -> dict[str, Any]:
    return {to_snake(k): v for k, v in body.items()}
