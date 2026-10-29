"""Accounted work: one context names whose Requests they are and pays (ADR-041).

Every piece of work that reaches Telegram opens one Accounted work, here and
nowhere else. The caller names the work, never the payer, and the payer and the
Request kind follow from the value:

* `Sync`: a Channel's sync or a direct sync job. Pays from the Budget its sync
  mode derives; kind auto, bulk or single from that Budget.
* `Follow`: a bulk Follow's handle checks. Pays from manual bulk; kind follow.
* `Probe`: a Directory probe. Pays into the probe tally, never an Account's
  Budget (ADR-014); kind probe, no Account.
* `Uncharged`: a handle check or a Bot API call. Pays nothing; records the
  Account that asked, as given.

This module is the only one that sets a Request's kind, Account, Budget and
job (`tests/services/test_request_accounting.py` walks the AST for it), so the
record and the ledger cannot drift apart: both read the same attribution, and
the tally counts by the one charge rule in `request_recording.Page.record`.

**Who pays is resolved once, at entry,** with `quota.resolve_charge_owner`, so
the records and the ledger name the same Account, the Operator when the asking
Account is gone. A failed read must not fail the work: it proceeds on the raw
id, logs once, and the exit charge resolves again, as it always did.

**It pays once, on exit,** whether the work succeeded, failed or was cancelled,
then flushes the buffered records beside the ledger write. The charge writers
keep their own failure handling and transactions; this sequence is not atomic.
Work that made no charged Request writes no ledger row: the writers skip a zero.

**Accounted work never opens inside other Accounted work.** Either way of
allowing it, charging twice or charging the wrong Budget, is a silent
misbilling, and no production path nests.
"""

from __future__ import annotations

import contextvars
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import partial
from typing import Literal

from sqlmodel import Session

from app.core.db import engine
from app.core.request_recording import RequestKind, attributed, tallied
from app.services.async_db import run_db
from app.services.channel_setting_groups import SyncOperationMode
from app.services.directory_probe_usage import charge_probe_requests
from app.services.quota import (
    Budget,
    budget_for_sync_mode,
    charge_budget,
    resolve_charge_owner,
)
from app.services.request_kinds import kind_for_sync_mode
from app.services.request_stats import flush_recorded_requests
from app.services.telegram_web import normalize_handle

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Sync:
    """A sync of an Account's Channels, charged to its sync mode's Budget."""

    account_id: uuid.UUID | None
    sync_mode: SyncOperationMode
    job_id: str


@dataclass(frozen=True)
class Follow:
    """A bulk Follow's handle checks, charged to manual bulk as one batch."""

    account_id: uuid.UUID | None
    job_id: str


@dataclass(frozen=True)
class Probe:
    """A Directory probe of one handle: the deployment's load, nobody's Budget."""

    handle: str


@dataclass(frozen=True)
class Uncharged:
    """Work nobody pays for, naming the Account that asked, as given."""

    kind: Literal[RequestKind.HANDLE, RequestKind.BOT_API]
    account_id: uuid.UUID | None
    channel: str | None = None


Work = Sync | Follow | Probe | Uncharged


class NestedAccountedWork(RuntimeError):
    """Accounted work opened inside other Accounted work. See the module docstring."""


_open: contextvars.ContextVar[Work | None] = contextvars.ContextVar(
    "tg_accounted_work", default=None
)


@asynccontextmanager
async def accounted_work(work: Work) -> AsyncIterator[None]:
    """Attribute and pay for the Requests made inside this block."""
    outer = _open.get()
    if outer is not None:
        raise NestedAccountedWork(f"{work!r} opened inside {outer!r}")
    token = _open.set(work)
    try:
        if isinstance(work, Uncharged):
            with attributed(
                kind=work.kind, account_id=work.account_id, channel=work.channel
            ):
                yield
            return
        charge: Callable[[int], None]
        if isinstance(work, Probe):
            who = attributed(
                kind=RequestKind.PROBE, channel=normalize_handle(work.handle)
            )
            charge = charge_probe_requests
        else:
            if isinstance(work, Sync):
                kind = kind_for_sync_mode(work.sync_mode)
                budget = budget_for_sync_mode(work.sync_mode)
            else:
                kind, budget = RequestKind.FOLLOW, Budget.MANUAL_BULK
            payer = await _resolve_payer(work.account_id)
            who = attributed(
                kind=kind, account_id=payer, budget=budget.value, job_id=work.job_id
            )
            charge = partial(charge_budget, payer, budget)
        with who, tallied() as tally:
            try:
                yield
            finally:
                await run_db(charge, tally.requests)
                await run_db(flush_recorded_requests)
    finally:
        _open.reset(token)


async def _resolve_payer(account_id: uuid.UUID | None) -> uuid.UUID | None:
    try:
        return await run_db(_read_payer, account_id)
    except Exception:  # noqa: BLE001
        # The exit charge resolves again, so the ledger stays right; only
        # these records keep the raw id.
        logger.exception(
            "Quota: could not resolve who pays for %s; recording it as given",
            account_id,
        )
        return account_id


def _read_payer(account_id: uuid.UUID | None) -> uuid.UUID | None:
    with Session(engine) as session:
        return resolve_charge_owner(session, account_id)
