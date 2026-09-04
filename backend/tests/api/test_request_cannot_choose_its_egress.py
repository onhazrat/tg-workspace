"""No request body names the proxies it goes out through.

ADR-012 D6. `ProxyConfig` carried a `proxies` list that three browser call
sites filled with `activeProxies` — which the browser derived from
`defaultProxyUrls`, the setting the server reads for itself one line later. So
the field was redundant rather than legitimate, and a field a client can set is
a field a client can set to *something else*: an authenticated caller could
name an address of their choosing and have the deployment fetch through it.

`proxyEnabled` stays, and the distinction is the point. Whether to route at all
is a request-level question a caller may answer; *where* is a deployment
setting, and the server is the only thing that reads it.
"""

from __future__ import annotations

import pathlib

import pytest

from app.schemas.data import BulkFollowRequest
from app.schemas.telegram import (
    BotInfoRequest,
    ChannelInfoRequest,
    ProxyConfig,
    PublishRequest,
    ScrapeRequest,
)

#: Every request model that used to carry the field, and its subclasses.
EGRESS_BODIES = [
    ProxyConfig,
    ScrapeRequest,
    ChannelInfoRequest,
    BotInfoRequest,
    PublishRequest,
    BulkFollowRequest,
]


@pytest.mark.parametrize("model", EGRESS_BODIES, ids=lambda m: m.__name__)
def test_no_request_body_declares_proxies(model: type) -> None:
    assert "proxies" not in model.model_fields, (
        f"{model.__name__} lets the caller name the egress; a deployment "
        "routing over Tor can be told to fetch from an address of the "
        "caller's choosing instead"
    )


@pytest.mark.parametrize("model", EGRESS_BODIES, ids=lambda m: m.__name__)
def test_whether_to_route_is_still_the_callers_to_say(model: type) -> None:
    """The other half. Removing `proxyEnabled` too would be a different change
    — one that takes away a switch people use — and the guard above would not
    notice, because absence satisfies it."""
    assert "proxy_enabled" in model.model_fields


def test_an_old_client_is_answered_and_its_list_dropped() -> None:
    """Pydantic ignores unknown fields by default, so a stale browser sending
    the old shape still works and its list goes nowhere. Asserted because
    "ignored" and "honoured" look identical from outside."""
    parsed = ChannelInfoRequest.model_validate(
        {
            "channelName": "durov",
            "proxyEnabled": True,
            "proxies": ["http://attacker.example:9999"],
        }
    )

    assert not hasattr(parsed, "proxies")
    assert parsed.proxy_enabled is True


def test_the_browser_stopped_sending_it() -> None:
    """Server-side removal alone leaves the browser sending a field into a
    void, which reads to the next person as a wire contract that still exists."""
    frontend = pathlib.Path(__file__).resolve().parents[3] / "frontend" / "src"
    senders = [
        str(path.relative_to(frontend.parents[1]))
        for path in frontend.rglob("*.ts*")
        if "client/" not in str(path) and "proxies: activeProxies" in path.read_text()
    ]

    assert not senders, f"{senders} still send a proxy list the server ignores"
