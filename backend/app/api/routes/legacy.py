"""Legacy /api/* route aliases for backward compatibility during migration."""

from typing import Any

from fastapi import APIRouter, Request

from app.api.routes import network, telegram
from app.schemas.telegram import (
    BotInfoRequest,
    ChannelInfoRequest,
    PublishRequest,
    ScrapeRequest,
    TestProxyRequest,
    TorNewIdentityRequest,
)

router = APIRouter(prefix="/api", tags=["legacy"])


@router.post("/test-proxy")
async def legacy_test_proxy(request: Request) -> dict:
    body = TestProxyRequest.model_validate(await request.json())
    return await network.api_test_proxy(body)


@router.get("/proxy-health")
def legacy_proxy_health() -> dict:
    return network.api_proxy_health()


@router.get("/tor-status")
async def legacy_tor_status() -> dict:
    return await network.api_tor_status()


@router.get("/tor-ip")
async def legacy_tor_ip() -> dict:
    return await network.api_tor_ip()


@router.post("/tor-restart")
async def legacy_tor_restart() -> dict:
    return await network.api_tor_restart()


@router.post("/tor-new-identity")
async def legacy_tor_new_identity(request: Request) -> dict:
    data = await request.json()
    body = TorNewIdentityRequest(port=data.get("port"))
    return await network.api_tor_new_identity(body)


@router.post("/bot-info")
async def legacy_bot_info(request: Request) -> dict[str, Any]:
    body = BotInfoRequest.model_validate(await request.json())
    return await telegram.api_bot_info(body)


@router.post("/publish")
async def legacy_publish(request: Request) -> dict[str, Any]:
    body = PublishRequest.model_validate(await request.json())
    return await telegram.api_publish(body)


@router.post("/channel-info")
async def legacy_channel_info(request: Request) -> dict[str, Any]:
    body = ChannelInfoRequest.model_validate(await request.json())
    return await telegram.api_channel_info(body)


@router.post("/scrape")
async def legacy_scrape(request: Request) -> dict[str, Any]:
    body = ScrapeRequest.model_validate(await request.json())
    return await telegram.api_scrape(body)
