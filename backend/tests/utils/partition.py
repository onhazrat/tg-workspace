"""Building a scraping Partition of a known width, for tests about dispatch.

Since ADR-012 a Slot always has a Lane, so "a partition of N workers with no
proxy" is a partition of N workers on the **direct** Lane. That is the shape a
proxy-less deployment really runs, rather than the `lane=None` special case it
replaced — and it is what these tests want, because they are about dispatch
*order* rather than about which egress a message went out of.
"""

from __future__ import annotations

import asyncio

from app.services.network_settings import DIRECT_EGRESS_KEY
from app.services.proxy_pool import ProxyLane, ProxyWorkerPool, build_workers


def direct_lane(width: int) -> ProxyLane:
    """One direct Lane `width` slots wide, with no client behind it.

    `client` is None because nothing here makes a request. A test that does
    should take the Lane from a real `ProxyPoolManager` instead.
    """
    return ProxyLane(
        url=DIRECT_EGRESS_KEY,
        max_parallel=width,
        sem=asyncio.Semaphore(width),
        client=None,  # type: ignore[arg-type]
    )


def direct_partition(width: int) -> ProxyWorkerPool:
    """A Partition `width` Slots wide, all on the direct Lane."""
    return ProxyWorkerPool(build_workers([direct_lane(width)]))
