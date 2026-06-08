from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.telegram import TestProxyRequest, TorNewIdentityRequest
from app.services.network import (
    get_bad_proxies,
    get_tor_ip,
    get_tor_status,
    rotate_tor_identity,
    test_proxy,
)

router = APIRouter(prefix="/network", tags=["network"])


@router.post("/test-proxy")
async def api_test_proxy(body: TestProxyRequest) -> dict:
    return await test_proxy(body.proxy_url)


@router.get("/proxy-health")
def api_proxy_health() -> dict:
    return {"badProxies": get_bad_proxies()}


@router.get("/tor-status")
async def api_tor_status() -> dict:
    return await get_tor_status()


@router.get("/tor-ip")
async def api_tor_ip() -> dict:
    try:
        ip = await get_tor_ip()
        return {"ip": ip}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to fetch IP via TOR: {exc}") from exc


@router.post("/tor-restart")
async def api_tor_restart() -> dict:
    return {"success": True, "message": "TOR restart not managed in container; restart tor sidecar"}


@router.post("/tor-new-identity")
async def api_tor_new_identity(body: TorNewIdentityRequest) -> dict:
    try:
        port = body.port or settings.TOR_CONTROL_PORT
        await rotate_tor_identity(port)
        return {"success": True, "message": "New identity requested successfully"}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to request new identity: {exc}") from exc
