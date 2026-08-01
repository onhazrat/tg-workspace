import hashlib
import logging
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.secrets import decrypt_token
from app.models_tg import BotCredential
from app.schemas.telegram import (
    BotInfoRequest,
    ChannelInfoRequest,
    PublishRequest,
    ResolveStartTimeRequest,
    ScrapeRequest,
)
from app.schemas.telegram_ops import (
    BotInfoResponse,
    ChannelInfoResponse,
    PublishResponse,
    ResolveStartTimeResponse,
    ScrapeChannelResponse,
)
from app.services.channel_photos import read_cached_photo
from app.services.network import fetch_with_retry, parse_telegram_entities
from app.services.network_settings import (
    load_network_settings,
    resolve_proxies_for_user,
    resolve_proxy_concurrency,
)
from app.services.post_thumbnails import read_cached_thumb
from app.services.scraper import (
    get_channel_info,
    resolve_start_time_to_id,
    scrape_channel,
)
from app.services.telegram_web import TelegramWebViewUnavailable

router = APIRouter(prefix="/telegram", tags=["telegram"])
logger = logging.getLogger(__name__)


def _resolve_proxy_concurrency(
    _body: ScrapeRequest
    | ChannelInfoRequest
    | BotInfoRequest
    | PublishRequest
    | ResolveStartTimeRequest,
    *,
    session: Session | None = None,
    user_id: uuid.UUID | None = None,
) -> tuple[int, dict[str, int]] | None:
    if session is not None and user_id is not None:
        network = load_network_settings(session, user_id)
        return resolve_proxy_concurrency(network)
    return None


def _resolve_proxies(
    body: ScrapeRequest
    | ChannelInfoRequest
    | BotInfoRequest
    | PublishRequest
    | ResolveStartTimeRequest,
    *,
    session: Session | None = None,
    user_id: uuid.UUID | None = None,
) -> list[str] | None:
    if body.proxies:
        return body.proxies
    if session is not None and user_id is not None and body.proxy_enabled:
        proxies = resolve_proxies_for_user(session, user_id)
        return proxies or None
    if body.proxy_enabled and settings.default_proxies:
        return settings.default_proxies
    if settings.default_proxies:
        return settings.default_proxies
    return None


def _resolve_bot_token(
    session: Session,
    credential_id: str | None,
    raw_token: str | None,
    *,
    current_user: Any | None = None,
) -> str:
    if credential_id:
        bot = session.get(BotCredential, credential_id)
        if not bot:
            raise HTTPException(status_code=404, detail="Bot credential not found")
        if (
            current_user is not None
            and bot.user_id is not None
            and bot.user_id != current_user.id
        ):
            raise HTTPException(status_code=403, detail="Bot credential not accessible")
        try:
            return decrypt_token(bot.token_encrypted)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if raw_token:
        if settings.ENVIRONMENT != "local":
            raise HTTPException(
                status_code=400,
                detail="Raw bot tokens are not accepted; use credentialId instead",
            )
        return raw_token
    raise HTTPException(status_code=400, detail="credentialId or token is required")


@router.post("/scrape")
async def api_scrape(
    body: ScrapeRequest, _current_user: CurrentUser
) -> ScrapeChannelResponse:
    try:
        return ScrapeChannelResponse.model_validate(
            await scrape_channel(
                body.url,
                known_latest_id=body.known_latest_id,
                known_display_name=body.known_display_name,
                known_photo_url=body.known_photo_url,
                proxies=_resolve_proxies(body),
                tor_auto_rotate=body.tor_auto_rotate,
                tor_rotation_threshold=body.tor_rotation_threshold,
                proxy_concurrency=_resolve_proxy_concurrency(body),
            )
        )
    except TelegramWebViewUnavailable as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": str(exc), "isUnavailableOnWebView": True},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, httpx.HTTPStatusError):
            if exc.response.status_code == 429:
                raise HTTPException(
                    status_code=429, detail="Telegram rate limit exceeded"
                ) from exc
            if exc.response.status_code == 404:
                raise HTTPException(
                    status_code=404, detail="Channel not found or private."
                ) from exc
        logger.exception("Failed to scrape channel")
        raise HTTPException(status_code=500, detail="Failed to scrape channel") from exc


@router.post("/channel-info")
async def api_channel_info(
    body: ChannelInfoRequest, _current_user: CurrentUser
) -> ChannelInfoResponse:
    try:
        return ChannelInfoResponse.model_validate(
            await get_channel_info(
                body.channel_name,
                proxies=_resolve_proxies(body),
                tor_auto_rotate=body.tor_auto_rotate,
                tor_rotation_threshold=body.tor_rotation_threshold,
                proxy_concurrency=_resolve_proxy_concurrency(body),
            )
        )
    except TelegramWebViewUnavailable as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": str(exc), "isUnavailableOnWebView": True},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to fetch channel info")
        raise HTTPException(
            status_code=500, detail="Failed to fetch channel info"
        ) from exc


@router.post("/resolve-start-time")
async def api_resolve_start_time(
    body: ResolveStartTimeRequest, _current_user: CurrentUser
) -> ResolveStartTimeResponse:
    try:
        start_id = await resolve_start_time_to_id(
            body.channel_name,
            body.target_time_ms,
            proxies=_resolve_proxies(body),
            tor_auto_rotate=body.tor_auto_rotate,
            tor_rotation_threshold=body.tor_rotation_threshold,
            proxy_concurrency=_resolve_proxy_concurrency(body),
        )
        return ResolveStartTimeResponse.model_validate({"startId": start_id})
    except TelegramWebViewUnavailable as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": str(exc), "isUnavailableOnWebView": True},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to resolve start time")
        raise HTTPException(
            status_code=500, detail="Failed to resolve start time"
        ) from exc


@router.post("/bot-info")
async def api_bot_info(
    body: BotInfoRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> BotInfoResponse:
    token = _resolve_bot_token(
        session, body.credential_id, body.token, current_user=current_user
    )
    target = f"https://api.telegram.org/bot{token}/{body.method}"
    if body.params:
        from urllib.parse import urlencode

        target += f"?{urlencode(body.params)}"
    try:
        data, telemetry = await fetch_with_retry(
            target,
            retries=settings.TELEGRAM_API_RETRIES,
            initial_delay_ms=settings.TELEGRAM_API_INITIAL_DELAY_MS,
            proxies=_resolve_proxies(body, session=session, user_id=current_user.id),
            tor_auto_rotate=body.tor_auto_rotate,
            tor_rotation_threshold=body.tor_rotation_threshold,
            proxy_concurrency=_resolve_proxy_concurrency(
                body, session=session, user_id=current_user.id
            ),
        )
        if isinstance(data, str):
            import json

            data = json.loads(data)
        return BotInfoResponse.model_validate({**data, "telemetry": telemetry})
    except Exception as exc:  # noqa: BLE001
        logger.exception("Bot info request failed")
        raise HTTPException(status_code=500, detail="Bot info request failed") from exc


@router.post("/publish")
async def api_publish(
    body: PublishRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PublishResponse:
    token = _resolve_bot_token(
        session, body.credential_id, body.token, current_user=current_user
    )
    target = f"https://api.telegram.org/bot{token}/sendMessage"
    results: list[Any] = []
    telemetry_logs: list[Any] = []

    async def send_chunk(chunk: str) -> None:
        parsed_text, entities = parse_telegram_entities(chunk)
        payload: dict[str, Any] = {
            "chat_id": body.chat_id,
            "text": parsed_text,
        }
        if entities:
            payload["entities"] = entities
        data, telem = await fetch_with_retry(
            target,
            retries=settings.TELEGRAM_API_RETRIES,
            initial_delay_ms=settings.TELEGRAM_API_INITIAL_DELAY_MS,
            proxies=_resolve_proxies(body, session=session, user_id=current_user.id),
            tor_auto_rotate=body.tor_auto_rotate,
            tor_rotation_threshold=body.tor_rotation_threshold,
            proxy_concurrency=_resolve_proxy_concurrency(
                body, session=session, user_id=current_user.id
            ),
            method="POST",
            json_body=payload,
        )
        if isinstance(data, str):
            import json

            data = json.loads(data)
        results.append(data)
        telemetry_logs.append(telem)

    try:
        if body.metadata_text:
            for i in range(0, len(body.metadata_text), 4000):
                await send_chunk(body.metadata_text[i : i + 4000])
        for i in range(0, len(body.text), 4000):
            await send_chunk(body.text[i : i + 4000])
        return PublishResponse(success=True, results=results, telemetry=telemetry_logs)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Publish request failed")
        raise HTTPException(status_code=500, detail="Publish request failed") from exc


def _image_response(
    request: Request,
    content: bytes,
    content_type: str,
) -> Response:
    """Serve a cached image with validators, so repeat views are cheap.

    The Channels tab issues one of these per visible channel, and before this the
    responses carried no caching headers at all — every reload re-downloaded every
    avatar. Channel photos change rarely, so:

    * `ETag` lets the browser revalidate and take a bodiless 304.
    * `max-age` skips the request entirely for a while.
    * `private` because the route is authenticated; this must never be held by a
      shared cache that could serve it to another user.
    """
    etag = f'"{hashlib.sha256(content).hexdigest()[:32]}"'
    headers = {
        "Cache-Control": (f"private, max-age={settings.CHANNEL_IMAGE_MAX_AGE_SECONDS}"),
        "ETag": etag,
    }

    # `If-None-Match` may carry several validators, and a proxy may have made ours
    # weak (`W/"..."`) in transit.
    provided = request.headers.get("if-none-match", "")
    if any(tag.strip().removeprefix("W/") == etag for tag in provided.split(",")):
        return Response(status_code=304, headers=headers)

    return Response(content=content, media_type=content_type, headers=headers)


@router.get("/channel-photo/{channel_id}")
async def api_channel_photo(
    channel_id: str,
    request: Request,
    _current_user: CurrentUser,
) -> Response:
    cached = read_cached_photo(channel_id)
    if not cached:
        raise HTTPException(status_code=404, detail="Channel photo not found")
    content, content_type = cached
    return _image_response(request, content, content_type)


@router.get("/post-thumb/{channel_name}/{post_id}")
async def api_post_thumb(
    channel_name: str,
    post_id: int,
    request: Request,
    _current_user: CurrentUser,
) -> Response:
    cached = read_cached_thumb(channel_name, post_id)
    if not cached:
        raise HTTPException(status_code=404, detail="Post thumbnail not found")
    content, content_type = cached
    return _image_response(request, content, content_type)


@router.get("/bot-file/{credential_id}")
async def api_bot_file(
    credential_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    path: str = Query(..., min_length=1),
) -> Response:
    token = _resolve_bot_token(session, credential_id, None, current_user=current_user)
    file_url = f"https://api.telegram.org/file/bot{token}/{path}"
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(file_url)
            response.raise_for_status()
            content = response.content
        content_type = response.headers.get("content-type", "application/octet-stream")
        return Response(content=content, media_type=content_type)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to fetch bot file")
        raise HTTPException(status_code=502, detail="Failed to fetch bot file") from exc
