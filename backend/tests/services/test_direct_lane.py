"""A deployment with no proxies still has a Lane, and it is never parked.

ADR-012's rule is that every request to Telegram leaves through an acquired
Lane. The obvious way to write that is "unless there are no proxies", and that
exemption enforces the seam only on the deployments that already had egress
control — the population that needs it least. So the pool synthesises a direct
Lane instead, and this file is what keeps that synthetic Lane an ordinary one.

**The two properties are opposite in shape and both matter.** It has to behave
like a Lane (a width, a reused client, a permit) or the seam is decoration; and
it has to be exempt from cooldown, because cooldown steers work away from a bad
proxy and onto the healthy ones, and there is nowhere to steer when the fleet
is one synthetic Lane. Parking it stops the deployment for ten minutes and
reports every worker parked, which is a worse failure than the transient one
that armed it.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.core.config import Settings, settings
from app.services import network
from app.services.network_settings import DIRECT_EGRESS_KEY
from app.services.proxy_pacing import FetchOutcome, ProxyPace
from app.services.proxy_pool import ProxyPoolManager, build_workers


def _configured(proxies: list[str], default_slots: int = 1) -> ProxyPoolManager:
    pool = ProxyPoolManager()
    pool.configure(proxies, default_slots, {})
    return pool


def test_a_deployment_with_no_proxies_still_has_a_lane() -> None:
    pool = _configured([])

    lanes = pool.lanes()
    assert [lane.url for lane in lanes] == [DIRECT_EGRESS_KEY]
    assert lanes[0].max_parallel == settings.DIRECT_LANE_CONCURRENCY_DEFAULT
    # An ordinary lane: a real semaphore and a real long-lived client, which is
    # the connection reuse the per-attempt `httpx.AsyncClient` never had.
    assert lanes[0].sem._value == settings.DIRECT_LANE_CONCURRENCY_DEFAULT
    assert lanes[0].client is not None


def test_the_direct_lane_carries_no_proxy() -> None:
    """It is a lane, not a proxy. Sending `"direct"` to httpx as a proxy URL
    would be an unparsable address rather than the absence of one."""
    lane = _configured([]).lanes()[0]

    assert lane.client._mounts == {} or all(
        transport is None for transport in lane.client._mounts.values()
    )


def test_the_direct_lane_is_a_permit_and_not_a_free_for_all() -> None:
    """The width has to actually bound requests, or synthesising the lane buys
    telemetry and nothing else. A single-address deployment is the one most
    likely to be rate limited by Telegram."""
    pool = _configured([])
    lane = pool.lanes()[0]
    lane.max_parallel = 1
    lane.sem = asyncio.Semaphore(1)

    async def _run() -> list[str]:
        order: list[str] = []

        async def worker(name: str) -> None:
            async with pool.hold(lane):
                order.append(f"in:{name}")
                await asyncio.sleep(0.05)
                order.append(f"out:{name}")

        await asyncio.gather(worker("a"), worker("b"))
        return order

    order = asyncio.run(_run())
    # Never two `in:` in a row — the second waited for the first to release.
    assert order[0].startswith("in:") and order[1].startswith("out:")


def test_a_proxy_less_partition_did_not_narrow() -> None:
    """`syncConcurrency` is going away, and the removal must be monotonic.

    A proxy-less deployment's scraping width was `syncConcurrency`, default 3.
    If the direct lane's width defaulted to `PROXY_DEFAULT_CONCURRENCY_DEFAULT`
    — the obvious reuse, since it is "the default slots per lane" — that
    deployment would go from three concurrent walks to one on an upgrade that
    advertises itself as removing a ceiling.
    """
    # `model_fields[...].default`, not the resolved setting: this repo's own
    # `.env` raises `SYNC_CONCURRENCY_DEFAULT`, and asserting resolved values
    # would make the guard pass or fail on the developer's environment rather
    # than on the code. `test_env_example_matches_defaults.py` makes the same
    # distinction for the same reason.
    # `>=`, not `==`. The claim is "nobody narrows", and the direct Lane is
    # per process: in the API it bounds every outbound request the tier makes,
    # which was unbounded before ADR-012, so it is sized above the worker's old
    # scraping width rather than exactly at it. Equality would be asserting a
    # coincidence and would fail the moment either number moved for its own
    # reasons.
    assert (
        Settings.model_fields["DIRECT_LANE_CONCURRENCY_DEFAULT"].default
        >= Settings.model_fields["SYNC_CONCURRENCY_DEFAULT"].default
    )
    # And the width the pool actually builds is that setting, not a literal.
    lanes = _configured([]).lanes()
    assert len(build_workers(lanes)) == settings.DIRECT_LANE_CONCURRENCY_DEFAULT


def test_the_direct_lane_is_never_put_into_cooldown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A proxy that fails is routed around; a single address cannot be."""
    network.reset_proxy_pacing_for_tests()
    monkeypatch.setattr(
        network, "should_arm_cooldown", lambda *_a, **_k: True, raising=True
    )

    async def _boom(*_args: Any, **_kwargs: Any) -> Any:
        raise ConnectionError("telegram said no")

    monkeypatch.setattr(network, "_fetch_once", _boom)

    async def _run() -> None:
        with pytest.raises(ConnectionError):
            await network.fetch_with_retry(
                "https://t.me/s/somechannel", proxies=[], retries=1
            )

    asyncio.run(_run())

    assert DIRECT_EGRESS_KEY not in {
        entry["proxyUrl"] for entry in network.get_bad_proxies()
    }
    assert not network.proxy_in_cooldown(DIRECT_EGRESS_KEY)


def test_a_real_proxy_still_is(monkeypatch: pytest.MonkeyPatch) -> None:
    """The other half of the pair. Exempting `"direct"` by string is a special
    case, and a special case that swallowed every proxy would disarm cooldown
    for the deployments it exists for — silently, since a disarmed cooldown
    looks exactly like a healthy fleet."""
    network.reset_proxy_pacing_for_tests()
    proxy = "http://cooldown.example:8080"
    monkeypatch.setattr(
        network, "should_arm_cooldown", lambda *_a, **_k: True, raising=True
    )

    async def _boom(*_args: Any, **_kwargs: Any) -> Any:
        raise ConnectionError("telegram said no")

    monkeypatch.setattr(network, "_fetch_once", _boom)

    async def _run() -> None:
        with pytest.raises(ConnectionError):
            await network.fetch_with_retry(
                "https://t.me/s/somechannel", proxies=[proxy], retries=1
            )

    asyncio.run(_run())

    assert network.proxy_in_cooldown(proxy), (
        "the direct-lane exemption swallowed a real proxy, so cooldown is off "
        "for the deployments it exists for — and a disarmed cooldown looks "
        "exactly like a healthy fleet"
    )
    network.reset_proxy_pacing_for_tests()


def test_the_pace_ladder_still_reaches_the_direct_lane() -> None:
    """Exempting it from cooldown must not exempt it from slowing down.

    Cooldown is the top rung and it is off for this lane; the widening wait
    below it is what is left, and it is the rung that can make a single-address
    deployment polite without stopping it.
    """
    network.reset_proxy_pacing_for_tests()
    pace = network._record_pace_failure(DIRECT_EGRESS_KEY, FetchOutcome.REJECTION)

    assert isinstance(pace, ProxyPace)
    assert network.proxy_pace_ms(DIRECT_EGRESS_KEY) > 0
    network.reset_proxy_pacing_for_tests()


def test_a_caller_with_no_proxies_does_not_evict_the_fleet() -> None:
    """The defect the direct Lane's first draft shipped, caught by a hang.

    The first version built the direct Lane inside `configure()` by answering
    an empty proxy list with `[DIRECT_EGRESS_KEY]`. The pool is one object
    shared by every caller in the process, so a Bot API publish that resolved
    no proxies would replace the fleet a page fetch had just configured —
    closing its live clients — and the next page fetch would replace it back.
    Under the test suite that thrash deadlocked on `aclose()` of a client
    belonging to an event loop that had already finished, holding `_pool_lock`
    while it did, which stops every later caller in the process for good.

    An empty list is *one caller's* answer, never the deployment's. So it
    reaches `direct_lane()` and never `configure()`.
    """
    pool = _configured(["http://fleet.example:8080"])
    before = [lane.url for lane in pool.lanes()]
    client_before = pool.lanes()[0].client

    # What a caller resolving no proxies does now: takes the direct Lane.
    direct = pool.direct_lane()

    assert direct.url == DIRECT_EGRESS_KEY
    assert [lane.url for lane in pool.lanes()] == before, (
        "resolving no proxies evicted the configured fleet; two callers with "
        "different answers now close each other's live clients on every request"
    )
    assert pool.lanes()[0].client is client_before


def test_the_direct_lane_survives_a_reconfigure() -> None:
    """It is built once. Rebuilding it per `configure` call is the same thrash
    one level down — a live direct fetch would lose its client to an operator
    editing an unrelated proxy setting."""
    pool = _configured([])
    first = pool.direct_lane()

    pool.configure(["http://later.example:8080"], 1, {})
    pool.configure([], 1, {})

    assert pool.direct_lane() is first
