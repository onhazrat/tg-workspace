"""Complete metered work by charging its tally, then flushing Request records.

The caller chooses the existing Account charge or Directory probe tally. Their
writers keep their own failure handling and transactions; this sequence is not
atomic. Keeping it here makes failure and cancellation take the same exit path
as successful work, including a Follow that chains no sync.
"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from app.core.request_meter import metered
from app.services.async_db import run_db
from app.services.request_stats import flush_recorded_requests


@asynccontextmanager
async def metered_work(charge: Callable[[int], None]) -> AsyncIterator[None]:
    """Count this work's Requests, then charge and flush before leaving its meter."""
    with metered() as meter:
        try:
            yield
        finally:
            await run_db(charge, meter.telegram_requests)
            await run_db(flush_recorded_requests)
