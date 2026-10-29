"""One module's `asyncio` with its `sleep` replaced, leaving every other module's."""

import asyncio
from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import Any


async def no_sleep(_seconds: float) -> None:
    return None


def asyncio_without_sleep(
    sleep: Callable[[float], Awaitable[Any]] = no_sleep,
) -> SimpleNamespace:
    """`asyncio` for one module to see, `sleep` replaced. Patch it in as that
    module's `asyncio`.

    Setting `sleep` on `<module>.asyncio` patches the one shared `asyncio`
    module instead, so the event loop and every other module stop sleeping too,
    and a task cancel never lands where the test awaits it.
    `tests/deployment/test_test_isolation.py` guards it.
    """
    return SimpleNamespace(**{**vars(asyncio), "sleep": sleep})
