"""Run blocking SQLAlchemy work off the asyncio event loop."""

from __future__ import annotations

import asyncio
from collections.abc import Callable


async def run_db[T, **P](fn: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs) -> T:
    """Execute a synchronous DB helper in a worker thread.

    Typed with a `ParamSpec` rather than `Callable[..., T]` plus `*args: Any`,
    so the arguments are checked against `fn`'s own signature. That is not
    tidying: it was `Callable[..., T]`, and ticket 22 changed
    `_finalize_channel_error` to drop a `user_id` it no longer used while
    leaving the call site passing one. Every argument to every `run_db` call was
    unchecked, so the suite stayed green and the failure — a `TypeError` raised
    from inside the handler for an unexpected sync exception, swallowing the
    failed sync log and the auto-sync backoff with it — was reachable only on a
    path nothing exercises. `/code-review` found it. The signature is what stops
    the next one.
    """
    return await asyncio.to_thread(fn, *args, **kwargs)
