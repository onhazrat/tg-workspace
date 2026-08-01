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


class ProxyHealthResponse(BaseModel):
    """Proxies currently marked bad by the pool."""

    model_config = ConfigDict(populate_by_name=True)

    bad_proxies: list[str] = Field(default_factory=list, alias="badProxies")


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
