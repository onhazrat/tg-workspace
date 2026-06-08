from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.telegram import BotInfoRequest, ChannelInfoRequest, PublishRequest, ScrapeRequest
from app.services.network import fetch_with_retry, parse_telegram_entities
from app.services.scraper import get_channel_info, scrape_channel

router = APIRouter(prefix="/telegram", tags=["telegram"])


def _resolve_proxies(body: ScrapeRequest | ChannelInfoRequest | BotInfoRequest | PublishRequest) -> list[str] | None:
    if body.proxy_enabled and body.proxies:
        return body.proxies
    if settings.default_proxies:
        return settings.default_proxies
    return None


@router.post("/scrape")
async def api_scrape(body: ScrapeRequest) -> dict[str, Any]:
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
        raise HTTPException(status_code=500, detail=f"Failed to scrape: {msg}") from exc


@router.post("/channel-info")
async def api_channel_info(body: ChannelInfoRequest) -> dict[str, Any]:
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
        raise HTTPException(status_code=500, detail=f"Failed to fetch channel info: {msg}") from exc


@router.post("/bot-info")
async def api_bot_info(body: BotInfoRequest) -> dict[str, Any]:
    target = f"https://api.telegram.org/bot{body.token}/{body.method}"
    if body.params:
        from urllib.parse import urlencode

        target += f"?{urlencode(body.params)}"
    try:
        data, telemetry = await fetch_with_retry(
            target,
            retries=3,
            initial_delay_ms=2000,
            proxies=_resolve_proxies(body),
            tor_auto_rotate=body.tor_auto_rotate,
            tor_rotation_threshold=body.tor_rotation_threshold,
        )
        if isinstance(data, str):
            import json

            data = json.loads(data)
        return {**data, "telemetry": telemetry}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/publish")
async def api_publish(body: PublishRequest) -> dict[str, Any]:
    target = f"https://api.telegram.org/bot{body.token}/sendMessage"
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
            retries=3,
            initial_delay_ms=2000,
            proxies=_resolve_proxies(body),
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
        raise HTTPException(status_code=500, detail=str(exc)) from exc
