"""Accounted work attributes and pays in one place (ADR-041, ACW-01).

Seam 1: each test opens Accounted work as a caller does and makes Requests
through the real `fetch_with_retry`, with only the single attempt stubbed, so
the retry loop, the page record and the charge decision all run. It then reads
what an Operator reads: the ledger, the probe tally and the flushed records.

The mutation each test is red under is named on it.
"""

from __future__ import annotations

import ast
import asyncio
import pathlib
import types
import uuid
from collections.abc import Callable, Generator, Iterator
from typing import Any

import httpx
import pytest
from sqlmodel import Session, col, select
from sqlmodel import delete as sa_delete

from app.core.db import engine
from app.core.request_recording import RequestKind, drain
from app.core.security import get_password_hash
from app.models import User
from app.models_tg import QuotaUsage, RequestRecordRow
from app.services import network, request_accounting
from app.services.directory_probe_usage import requests_on
from app.services.follows import get_operator_user_id
from app.services.request_accounting import (
    Follow,
    NestedAccountedWork,
    Probe,
    Sync,
    Uncharged,
    Work,
    accounted_work,
)
from app.services.request_stats import flush_recorded_requests
from app.services.telegram_web import TelegramWebViewUnavailable

WEB_VIEW = "https://t.me/s/acwchannel"
SOFT_BLOCKED = "https://t.me/s/acwrestricted"
PICTURE = "https://cdn4.telesco.pe/file/acw.jpg"
BOT_API = "https://api.telegram.org/bot123/getMe"


def _status(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", WEB_VIEW)
    return httpx.HTTPStatusError(
        str(code), request=request, response=httpx.Response(code, request=request)
    )


#: One page fetch walking a transport fault (free), a 404 (answered, so paid)
#: and the page (paid). A soft block, also paid, ends its fetch, so `_requests`
#: makes it apart. Three paid in all.
MIXED: list[Any] = [httpx.ConnectError("dead proxy"), _status(404), "<html>page</html>"]
PAGE_PAID = 2
PAID = PAGE_PAID + 1


async def _no_sleep(_seconds: float) -> None:
    return None


@pytest.fixture(autouse=True)
def _telegram(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Each task's page walks `MIXED` in order; everything else answers at once."""
    drain()
    scripts: dict[int, list[Any]] = {}

    async def fetch_once(url: str, **kwargs: Any) -> Any:
        if url == SOFT_BLOCKED:
            raise TelegramWebViewUnavailable()
        if url != WEB_VIEW:
            return (b"\xff", "image/jpeg") if kwargs.get("binary") else {"ok": True}
        task = id(asyncio.current_task())
        script = scripts.setdefault(task, list(MIXED))
        answer = script.pop(0)
        if not script:
            scripts.pop(task)
        if isinstance(answer, BaseException):
            raise answer
        return answer

    monkeypatch.setattr(network, "_fetch_once", fetch_once)
    # The soft blocks here widen the direct egress's pace; a table of this
    # test's own keeps that from slowing every later test's fetches.
    monkeypatch.setattr(network, "_proxy_pace", {})
    # Only `network`'s view of asyncio loses its sleep, so a cancel still lands
    # where the work under test awaits.
    monkeypatch.setattr(
        network,
        "asyncio",
        types.SimpleNamespace(**{**vars(asyncio), "sleep": _no_sleep}),
    )
    yield
    drain()


@pytest.fixture
def account() -> Generator[uuid.UUID]:
    user = User(
        email=f"acw-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=get_password_hash("acw-test-password"),
        is_approved=True,
    )
    with Session(engine) as session:
        session.add(user)
        session.commit()
        session.refresh(user)
        user_id = user.id
    yield user_id
    with Session(engine) as session:
        row = session.get(User, user_id)
        if row is not None:
            session.delete(row)
            session.commit()


@pytest.fixture
def operator() -> Generator[uuid.UUID]:
    """The bootstrap superuser, whose ledger rows this test clears itself."""
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
    assert operator_id is not None, "the test database has no bootstrap superuser"
    yield operator_id
    with Session(engine) as session:
        session.execute(
            sa_delete(QuotaUsage).where(col(QuotaUsage.user_id) == operator_id)
        )
        session.commit()


async def _requests() -> None:
    """One page walking `MIXED`, a soft block, a picture and a Bot API call."""
    await network.fetch_with_retry(WEB_VIEW, retries=len(MIXED), initial_delay_ms=0)
    with pytest.raises(TelegramWebViewUnavailable):
        await network.fetch_with_retry(SOFT_BLOCKED, retries=len(MIXED))
    await network.fetch_with_retry(PICTURE, retries=1, binary=True)
    await network.fetch_with_retry(BOT_API, retries=1)


def _run(work: Work, body: Callable[[], Any] = _requests) -> None:
    async def go() -> None:
        async with accounted_work(work):
            await body()

    asyncio.run(go())


def _ledger() -> list[tuple[uuid.UUID, str, int]]:
    with Session(engine) as session:
        rows = session.exec(select(QuotaUsage)).all()
    return sorted((r.user_id, r.budget, r.requests) for r in rows)


def _records() -> list[RequestRecordRow]:
    with Session(engine) as session:
        return list(session.exec(select(RequestRecordRow)).all())


def _probe_tally() -> int:
    with Session(engine) as session:
        return requests_on(session)


def _attribution(records: list[RequestRecordRow]) -> set[tuple[Any, ...]]:
    return {(r.kind, r.account_id, r.budget, r.job_id) for r in records}


# --------------------------------------------------------------------------
# One test per work value
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sync_mode", "kind", "budget"),
    [
        ("auto", "auto", "auto_sync"),
        ("bulk", "bulk", "manual_bulk"),
        ("individual", "single", "manual_single"),
    ],
)
def test_a_sync_charges_its_modes_budget_and_records_the_same(
    account: uuid.UUID, sync_mode: Any, kind: str, budget: str
) -> None:
    """Mutations: count every attempt that reached the network; mark a picture
    Charged; drop the exit flush.

    The ledger counts exactly the records marked Charged, under the same
    Account and Budget: three answered web view attempts out of six Requests.
    (Transport fault, 404, page, soft block, picture, Bot API.)
    """
    _run(Sync(account, sync_mode, "job-acw-sync"))

    records = _records()
    assert len(records) == len(MIXED) + 3
    assert _attribution(records) == {(kind, account, budget, "job-acw-sync")}
    assert sum(r.charged for r in records) == PAID
    assert _ledger() == [(account, budget, PAID)]
    assert _probe_tally() == 0


def test_a_follow_charges_manual_bulk_as_one_batch(account: uuid.UUID) -> None:
    """Mutation: pay a Follow from the Budget of a sync mode other than bulk.

    Two handles checked in one Follow are one ledger charge, each Request
    naming the handle it checked through the Channel refinement.
    """
    from app.core.request_recording import attributed

    async def two_handles() -> None:
        for handle in ("one", "two"):
            with attributed(channel=handle):
                await _requests()

    _run(Follow(account, "follow-acw"), two_handles)

    records = _records()
    assert _attribution(records) == {("follow", account, "manual_bulk", "follow-acw")}
    assert {r.channel for r in records} == {"one", "two"}
    assert sum(r.charged for r in records) == 2 * PAID
    assert _ledger() == [(account, "manual_bulk", 2 * PAID)]


def test_a_probe_pays_into_the_probe_tally_and_no_budget() -> None:
    """Mutations: give a probe a Budget; count the probe tally only on Charged
    records (it reads zero).

    Same rule, no Budget: the tally counts the answered web view attempts, the
    records stay Uncharged with no Account, and no ledger row is written.
    """
    _run(Probe("@AcwHandle"))

    records = _records()
    assert {(r.kind, r.account_id, r.budget, r.channel) for r in records} == {
        ("probe", None, None, "acwhandle")
    }
    assert not any(r.charged for r in records)
    assert _probe_tally() == PAID
    assert _ledger() == []


@pytest.mark.parametrize("kind", [RequestKind.HANDLE, RequestKind.BOT_API])
def test_uncharged_work_names_the_asking_account_as_given_and_pays_nothing(
    account: uuid.UUID, kind: Any
) -> None:
    """Mutation: give uncharged work a Budget.

    A handle check by an Account that is gone stays that Account's, never
    the Operator's, because nobody pays for it.
    """
    gone = uuid.uuid4()
    _run(Uncharged(kind, account, channel="acwchannel"))
    _run(Uncharged(kind, gone))
    flush_recorded_requests()

    records = _records()
    assert {(r.kind, r.account_id) for r in records} == {
        (kind.value, account),
        (kind.value, gone),
    }
    assert not any(r.charged or r.budget for r in records)
    assert _ledger() == []
    assert _probe_tally() == 0


# --------------------------------------------------------------------------
# Who pays
# --------------------------------------------------------------------------


def test_a_deleted_account_is_charged_to_the_operator_on_both_sides(
    operator: uuid.UUID,
) -> None:
    """Mutation: keep the raw Account on the records.

    The records and the ledger both name the Operator, so the Requests tab
    and the Budgets agree without a read-time patch.
    """
    _run(Sync(uuid.uuid4(), "individual", "job-acw-gone"))

    assert {r.account_id for r in _records()} == {operator}
    assert _ledger() == [(operator, "manual_single", PAID)]


def test_a_failed_entry_read_still_charges_the_resolved_account_at_exit(
    monkeypatch: pytest.MonkeyPatch, operator: uuid.UUID
) -> None:
    """Mutation: charge the Account as given, with no second resolution.

    The work goes ahead on the raw Account. The records keep it, and the exit
    charge resolves again, so the ledger still bills the Operator.
    """

    def broken(_account_id: object) -> None:
        raise RuntimeError("database away")

    monkeypatch.setattr(request_accounting, "_read_payer", broken)

    _run(Sync(None, "individual", "job-acw-entry"))

    assert {r.account_id for r in _records()} == {None}
    assert _ledger() == [(operator, "manual_single", PAID)]


# --------------------------------------------------------------------------
# Paying once, on every exit
# --------------------------------------------------------------------------


@pytest.mark.parametrize("ending", ["failed", "cancelled"])
def test_work_that_stops_still_pays_for_what_it_made(
    account: uuid.UUID, ending: str
) -> None:
    """Mutation: pay only when the block completes.

    Telegram answered those Requests before the work stopped.
    """

    async def stops() -> None:
        await _requests()
        if ending == "failed":
            raise RuntimeError("sync failed")
        task = asyncio.current_task()
        assert task is not None
        task.cancel()
        await asyncio.sleep(0)

    with pytest.raises(RuntimeError if ending == "failed" else asyncio.CancelledError):
        _run(Sync(account, "bulk", "job-acw-stop"), stops)

    assert sum(r.charged for r in _records()) == PAID
    assert _ledger() == [(account, "manual_bulk", PAID)]


def test_work_with_no_charged_request_writes_no_ledger_row(account: uuid.UUID) -> None:
    """Mutation: charge at least one Request whatever the count.

    A picture and a Bot API call are Uncharged, so the sync pays nothing.
    """

    async def uncharged_only() -> None:
        await network.fetch_with_retry(PICTURE, retries=1, binary=True)
        await network.fetch_with_retry(BOT_API, retries=1)

    _run(Sync(account, "auto", "job-acw-none"), uncharged_only)

    assert len(_records()) == 2
    assert _ledger() == []


def test_concurrent_work_keeps_separate_tallies_shared_by_its_tasks(
    account: uuid.UUID, operator: uuid.UUID
) -> None:
    """Mutation: share one tally between all work, as a module global would.

    Two syncs for two Accounts overlap, each spawning tasks: each Account pays
    for its own tasks' Requests and nothing of the other's.
    """

    async def tasks(n: int) -> None:
        await asyncio.gather(*(_requests() for _ in range(n)))

    async def both() -> None:
        async def one(work: Work, n: int) -> None:
            async with accounted_work(work):
                await tasks(n)

        await asyncio.gather(
            one(Sync(account, "auto", "job-acw-a"), 2),
            one(Sync(operator, "auto", "job-acw-b"), 3),
        )

    asyncio.run(both())

    assert _ledger() == sorted(
        [(account, "auto_sync", 2 * PAID), (operator, "auto_sync", 3 * PAID)]
    )


def test_work_stops_counting_once_it_ends(account: uuid.UUID) -> None:
    """Mutation: set the attribution without resetting it on exit.

    A Request after the work ended is nobody's: kind other, Uncharged.
    """

    async def then_after() -> None:
        async with accounted_work(Sync(account, "auto", "job-acw-end")):
            await network.fetch_with_retry(WEB_VIEW, retries=len(MIXED))
        await network.fetch_with_retry(WEB_VIEW, retries=len(MIXED))
        flush_recorded_requests()

    asyncio.run(then_after())

    assert _ledger() == [(account, "auto_sync", PAGE_PAID)]
    assert sum(r.charged for r in _records()) == PAGE_PAID
    assert {r.kind for r in _records() if not r.job_id} == {"other"}


# --------------------------------------------------------------------------
# Nesting, and the guard
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "inner",
    [
        Sync(None, "auto", "job-inner"),
        Probe("inner"),
        Uncharged(RequestKind.HANDLE, None),
    ],
    ids=["sync", "probe", "uncharged"],
)
def test_opening_accounted_work_inside_accounted_work_raises(
    account: uuid.UUID, inner: Work
) -> None:
    """Mutation: allow nesting.

    The outer work still pays for what it made before the refusal.
    """

    async def nested() -> None:
        await _requests()
        async with accounted_work(inner):
            await _requests()

    with pytest.raises(NestedAccountedWork):
        _run(Follow(account, "follow-acw-outer"), nested)

    assert _ledger() == [(account, "manual_bulk", PAID)]


#: The attribution only Accounted work may set (ADR-041).
PAYER_FIELDS = frozenset({"kind", "account_id", "budget", "job_id"})
ACCOUNTED_WORK_MODULE = "app/services/request_accounting.py"


def _payer_settings(tree: ast.AST) -> Iterator[tuple[int, str]]:
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
        if name in ("attributed", "Attribution"):
            for keyword in node.keywords:
                if keyword.arg in PAYER_FIELDS:
                    yield node.lineno, keyword.arg


def test_only_accounted_work_sets_kind_account_budget_or_job() -> None:
    """The guard. Mutation: pass `kind=` to `attributed` in any other module.

    A second place naming the payer is a second place that can name a
    different one: the record and the ledger drift apart again, which is
    what ADR-041 removed. Refining the Channel or best-effort stays open.
    """
    offenders = []
    for path in sorted(pathlib.Path("app").rglob("*.py")):
        if path.as_posix() == ACCOUNTED_WORK_MODULE:
            continue
        for line, field in _payer_settings(ast.parse(path.read_text())):
            offenders.append(f"{path}:{line} sets {field}")
    assert offenders == [], "only Accounted work names the payer"

    own = ast.parse(pathlib.Path(ACCOUNTED_WORK_MODULE).read_text())
    assert {field for _, field in _payer_settings(own)} == PAYER_FIELDS, (
        "the guard no longer sees the module it protects"
    )
