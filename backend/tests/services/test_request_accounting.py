"""Metered work charges and flushes on every exit, without sharing nested counts."""

import asyncio
import threading

import pytest

from app.core.request_meter import active_meter, record_telegram_request
from app.services import request_accounting


@pytest.mark.parametrize("outcome", ["completed", "failed", "cancelled"])
def test_every_exit_charges_then_flushes_off_the_event_loop(
    monkeypatch: pytest.MonkeyPatch, outcome: str
) -> None:
    calls: list[tuple[str, int | None]] = []
    loop_thread = threading.get_ident()

    def charge(requests: int) -> None:
        assert threading.get_ident() != loop_thread
        calls.append(("charge", requests))

    def flush() -> None:
        assert threading.get_ident() != loop_thread
        calls.append(("flush", None))

    monkeypatch.setattr(request_accounting, "flush_recorded_requests", flush)

    async def work() -> None:
        try:
            async with request_accounting.metered_work(charge):
                record_telegram_request()
                record_telegram_request()
                if outcome == "failed":
                    raise RuntimeError("work failed")
                if outcome == "cancelled":
                    task = asyncio.current_task()
                    assert task is not None
                    task.cancel()
                    await asyncio.sleep(0)
        finally:
            assert active_meter() is None

    if outcome == "failed":
        with pytest.raises(RuntimeError, match="work failed"):
            asyncio.run(work())
    elif outcome == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(work())
    else:
        asyncio.run(work())
    assert calls == [("charge", 2), ("flush", None)]


def test_work_with_no_charged_requests_still_flushes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int | str] = []
    monkeypatch.setattr(
        request_accounting, "flush_recorded_requests", lambda: calls.append("flush")
    )

    async def work() -> None:
        async with request_accounting.metered_work(calls.append):
            pass

    asyncio.run(work())
    assert calls == [0, "flush"]


def test_nested_work_restores_the_outer_meter_without_double_charging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, int | None]] = []
    monkeypatch.setattr(
        request_accounting,
        "flush_recorded_requests",
        lambda: calls.append(("flush", None)),
    )

    async def work() -> None:
        async with request_accounting.metered_work(
            lambda count: calls.append(("outer", count))
        ):
            outer = active_meter()
            record_telegram_request()
            async with request_accounting.metered_work(
                lambda count: calls.append(("inner", count))
            ):
                record_telegram_request()
                record_telegram_request()
            assert active_meter() is outer
            record_telegram_request()
        assert active_meter() is None

    asyncio.run(work())
    assert calls == [("inner", 2), ("flush", None), ("outer", 2), ("flush", None)]
