"""Response models for the proxy and Tor endpoints.

Part of B6 in `docs/architecture-simplification-plan.md`.

This family is unusually full of **conditional keys**, so most models here
declare only what is always present and let the rest travel through `extra`.
That is the established rule (B1): a declared optional field serialises as an
explicit `null` where the key is absent today, silently changing the payload.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class TestProxyResponse(BaseModel):
    """Result of probing one proxy URL.

    Two shapes behind one model. Success adds `ip` and `latency`; failure adds
    `error` instead. Only `success` and `proxyUrl` appear in both, so only those
    two are declared — the rest flow through `extra` exactly as today.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    success: bool
    proxy_url: str = Field(alias="proxyUrl")


class BadProxy(BaseModel):
    """One proxy in cooldown, with the seconds left on it."""

    model_config = ConfigDict(populate_by_name=True)

    url: str
    cooldown_remaining: int = Field(alias="cooldownRemaining")


class ProxyHealthResponse(BaseModel):
    """Proxies currently marked bad by the pool.

    `bad_proxies` was declared `list[str]` in B6, but
    `services/network.get_bad_proxies()` has always returned
    `list[dict[str, Any]]` — `{"url", "cooldownRemaining"}` per entry. The
    mismatch never showed because the list is empty on a healthy deployment;
    the moment any proxy entered cooldown, `model_validate` raised and
    `GET /api/v1/network/proxy-health` answered **500** — precisely when an
    operator would be looking at the panel. F2 found it by moving the caller
    onto the generated client, where the frontend's `as {url, cooldownRemaining}[]`
    cast stopped agreeing with the declared type.
    """

    model_config = ConfigDict(populate_by_name=True)

    bad_proxies: list[BadProxy] = Field(default_factory=list, alias="badProxies")


class TorStatusResponse(BaseModel):
    """Whether the Tor sidecar is reachable.

    `autoSpawned` is present only when Tor is enabled — the disabled branch
    returns a fixed four-key payload without it — so it is left to `extra`.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    running: bool = False
    socks_in_use: bool = Field(default=False, alias="socksInUse")
    control_in_use: bool = Field(default=False, alias="controlInUse")
    enabled: bool = False


class TorIpResponse(BaseModel):
    """The exit IP as seen through the Tor SOCKS proxy."""

    ip: str


class TorActionResponse(BaseModel):
    """Acknowledgement for a Tor control action (restart, new identity)."""

    success: bool
    message: str
