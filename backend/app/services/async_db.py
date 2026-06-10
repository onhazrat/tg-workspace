"""Run blocking SQLAlchemy work off the asyncio event loop."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


async def run_db(fn: Callable[..., T], /, *args, **kwargs) -> T:
    """Execute a synchronous DB helper in a worker thread."""
    return await asyncio.to_thread(fn, *args, **kwargs)
