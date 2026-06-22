"""Legacy /api/* route aliases for backward compatibility during migration.

DEPRECATED: Use /api/v1/* routes only. This router is mounted in non-production
environments only; production returns 410 Gone for /api/* paths. Scheduled for
removal after one release cycle once all clients migrate to /api/v1/*.
"""

import logging
from typing import Any

from fastapi import APIRouter, Response

from app.api.deps import CurrentUser, SessionDep
from app.api.routes import network, telegram
from app.schemas.telegram import (
    BotInfoRequest,
    ChannelInfoRequest,
    PublishRequest,
    ResolveStartTimeRequest,
    ScrapeRequest,
    TestProxyRequest,
    TorNewIdentityRequest,
)

router = APIRouter(prefix="/api", tags=["legacy"])
logger = logging.getLogger(__name__)


def _mark_deprecated(response: Response) -> None:
    response.headers["Deprecation"] = "true"
    response.headers["Link"] = '</api/v1/telegram>; rel="successor-version"'
    logger.warning("Legacy /api/* route called; migrate to /api/v1/*")


@router.post("/test-proxy")
async def legacy_test_proxy(
    body: TestProxyRequest,
    _current_user: CurrentUser,
    response: Response,
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await network.api_test_proxy(body, _current_user)


@router.get("/proxy-health")
def legacy_proxy_health(
    _current_user: CurrentUser, response: Response
) -> dict[str, Any]:
    _mark_deprecated(response)
    return network.api_proxy_health(_current_user)


@router.get("/tor-status")
async def legacy_tor_status(
    _current_user: CurrentUser, response: Response
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await network.api_tor_status(_current_user)


@router.get("/tor-ip")
async def legacy_tor_ip(
    _current_user: CurrentUser, response: Response
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await network.api_tor_ip(_current_user)


@router.post("/tor-restart")
async def legacy_tor_restart(
    _current_user: CurrentUser, response: Response
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await network.api_tor_restart(_current_user)


@router.post("/tor-new-identity")
async def legacy_tor_new_identity(
    body: TorNewIdentityRequest,
    _current_user: CurrentUser,
    response: Response,
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await network.api_tor_new_identity(body, _current_user)


@router.post("/bot-info")
async def legacy_bot_info(
    body: BotInfoRequest,
    session: SessionDep,
    current_user: CurrentUser,
    response: Response,
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await telegram.api_bot_info(body, session, current_user)


@router.post("/publish")
async def legacy_publish(
    body: PublishRequest,
    session: SessionDep,
    current_user: CurrentUser,
    response: Response,
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await telegram.api_publish(body, session, current_user)


@router.post("/channel-info")
async def legacy_channel_info(
    body: ChannelInfoRequest,
    current_user: CurrentUser,
    response: Response,
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await telegram.api_channel_info(body, current_user)


@router.post("/scrape")
async def legacy_scrape(
    body: ScrapeRequest,
    current_user: CurrentUser,
    response: Response,
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await telegram.api_scrape(body, current_user)


@router.post("/resolve-start-time")
async def legacy_resolve_start_time(
    body: ResolveStartTimeRequest,
    current_user: CurrentUser,
    response: Response,
) -> dict[str, Any]:
    _mark_deprecated(response)
    return await telegram.api_resolve_start_time(body, current_user)
