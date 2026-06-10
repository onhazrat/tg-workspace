import logging
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.secrets import decrypt_token
from app.models_tg import BotCredential
from app.services.network_settings import resolve_proxies_for_user
from app.schemas.telegram import (
    BotInfoRequest,
    ChannelInfoRequest,
    PublishRequest,
    ResolveStartTimeRequest,
    ScrapeRequest,
)
from app.services.network import fetch_with_retry, parse_telegram_entities
from app.services.scraper import get_channel_info, resolve_start_time_to_id, scrape_channel

router = APIRouter(prefix="/telegram", tags=["telegram"])
logger = logging.getLogger(__name__)


def _resolve_proxies(
    body: ScrapeRequest | ChannelInfoRequest | BotInfoRequest | PublishRequest | ResolveStartTimeRequest,
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
async def api_scrape(body: ScrapeRequest, _current_user: CurrentUser) -> dict[str, Any]:
    try:
        return await scrape_channel(
            body.url,
            known_latest_id=body.known_latest_id,
            known_display_name=body.known_display_name,
            known_photo_url=body.known_photo_url,
            proxies=_resolve_proxies(body),
            tor_auto_rotate=body.tor_auto_rotate,
            tor_rotation_threshold=body.tor_rotation_threshold,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "not available on the web view" in msg:
            raise HTTPException(
                status_code=400,
                detail={"error": msg, "isUnavailableOnWebView": True},
            ) from exc
        if isinstance(exc, httpx.HTTPStatusError):
            if exc.response.status_code == 429:
                raise HTTPException(status_code=429, detail="Telegram rate limit exceeded") from exc
            if exc.response.status_code == 404:
                raise HTTPException(status_code=404, detail="Channel not found or private.") from exc
        logger.exception("Failed to scrape channel")
        raise HTTPException(status_code=500, detail="Failed to scrape channel") from exc


@router.post("/channel-info")
async def api_channel_info(
    body: ChannelInfoRequest, _current_user: CurrentUser
) -> dict[str, Any]:
    try:
        return await get_channel_info(
            body.channel_name,
            proxies=_resolve_proxies(body),
            tor_auto_rotate=body.tor_auto_rotate,
            tor_rotation_threshold=body.tor_rotation_threshold,
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "not available on the web view" in msg:
            raise HTTPException(
                status_code=400,
                detail={"error": msg, "isUnavailableOnWebView": True},
            ) from exc
        logger.exception("Failed to fetch channel info")
        raise HTTPException(status_code=500, detail="Failed to fetch channel info") from exc


@router.post("/resolve-start-time")
async def api_resolve_start_time(
    body: ResolveStartTimeRequest, _current_user: CurrentUser
) -> dict[str, Any]:
    try:
        start_id = await resolve_start_time_to_id(
            body.channel_name,
            body.target_time_ms,
            proxies=_resolve_proxies(body),
            tor_auto_rotate=body.tor_auto_rotate,
            tor_rotation_threshold=body.tor_rotation_threshold,
        )
        return {"startId": start_id}
    except ValueError as exc:
        msg = str(exc)
        if "not available on the web view" in msg:
            raise HTTPException(
                status_code=400,
                detail={"error": msg, "isUnavailableOnWebView": True},
            ) from exc
        raise HTTPException(status_code=400, detail=msg) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to resolve start time")
        raise HTTPException(status_code=500, detail="Failed to resolve start time") from exc


@router.post("/bot-info")
async def api_bot_info(
    body: BotInfoRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
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
        )
        if isinstance(data, str):
            import json

            data = json.loads(data)
        return {**data, "telemetry": telemetry}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Bot info request failed")
        raise HTTPException(status_code=500, detail="Bot info request failed") from exc


@router.post("/publish")
async def api_publish(
    body: PublishRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> dict[str, Any]:
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
        return {"success": True, "results": results, "telemetry": telemetry_logs}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Publish request failed")
        raise HTTPException(status_code=500, detail="Publish request failed") from exc


@router.get("/bot-file/{credential_id}")
async def api_bot_file(
    credential_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    path: str = Query(..., min_length=1),
) -> Response:
    token = _resolve_bot_token(
        session, credential_id, None, current_user=current_user
    )
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
