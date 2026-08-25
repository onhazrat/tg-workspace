"""Counts the Requests one unit of work made to Telegram (ticket 08).

The Budget is denominated in HTTP Requests to the Telegram web view (decision 15
of `docs/multi-user-tenancy-plan.md`), and the only place that knows a Request
happened is `services/network.py::fetch_with_retry` — which knows nothing about
whose sync it is. `run_sync_job` knows whose sync it is and nothing about HTTP.

Threading a user id from the job through the orchestrator, the scraper and into
the HTTP client would put a parameter nobody on that path reads into a dozen
signatures, and every future call site would have to remember to pass it. So the
two ends meet through a `contextvars` meter instead: the job opens one, every
fetch underneath increments whatever is active, and the job reads the total when
it finishes.

**`contextvars` rather than a global** because concurrency here is the normal
case, not the exception. `run_sync_job` gathers a task per channel and two jobs
for two accounts overlap routinely. `asyncio` copies the current context into
each task at creation, so the tasks a job spawns share that job's meter, while a
second job running beside it increments its own. A module-level counter would
charge each of them for the other's work, and would do it only under
concurrency — the failure that never reproduces in a single-user test.

**No meter active means no counting**, so counting is something a caller opts
into rather than something every new call site has to remember to opt out of.
Two metered blocks exist today: `sync_orchestrator.run_sync_job` and
`bulk_follow.run_follow_job`. Everything else runs unmetered, and the list is
worth being exact about, because "the rest is trivial" is how an uncounted
caller stays uncounted:

* Not `t.me` at all, so never counted wherever they run — the Bot API
  (`publish.py`), thumbnail and avatar CDNs, proxy health checks.
* Genuinely `t.me`, and deliberately uncharged for now: the handle probes in
  `routes/telegram.py`, and `jobs/discover_probe.py`. The probe queue is the
  awkward one — it is a *scheduled* job fetching the web view every tick, which
  is exactly the background load the `auto_sync` Budget exists to throttle. It
  is uncharged because `DiscoverHandleProbe` is corpus-scoped (see
  `services/tenancy.py`): the queue is deployment-wide and no account owns an
  entry, so there is nobody to charge without inventing an owner. Ticket 23 has
  to decide whether the operator wears it; `docs/quota-ledger-plan.md` records
  the question.

This lives in `core/` rather than `services/` for the reason `async_db.py` is a
declared exception in `test_service_kinds.py`: it is infrastructure with no
domain in it, and calling it one of the five service kinds would be filing it
under the nearest wrong heading.
"""

from __future__ import annotations

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field


@dataclass
class RequestMeter:
    """A mutable tally shared by every task under one metered block.

    Mutable and shared on purpose: the `ContextVar` holds a *reference*, so a
    child task incrementing it is incrementing the parent's counter. Rebinding
    the variable to a new value instead would give each task its own tally and
    the job would read zero.
    """

    telegram_requests: int = field(default=0)

    def record_telegram_request(self) -> None:
        self.telegram_requests += 1


_active_meter: contextvars.ContextVar[RequestMeter | None] = contextvars.ContextVar(
    "tg_request_meter", default=None
)


@contextmanager
def metered() -> Iterator[RequestMeter]:
    """Count the Telegram Requests made inside this block.

    The token is reset on exit rather than the variable being set back to
    `None`: a nested block has to restore the *outer* meter, not clear the
    slot. Nothing nests these today, but a meter that silently stopped counting
    after an inner block closed would be found by nobody.
    """
    meter = RequestMeter()
    token = _active_meter.set(meter)
    try:
        yield meter
    finally:
        _active_meter.reset(token)


def record_telegram_request() -> None:
    """Count one Request to the Telegram web view, if anything is counting."""
    meter = _active_meter.get()
    if meter is not None:
        meter.record_telegram_request()


def active_meter() -> RequestMeter | None:
    """The meter in force, or `None`. For tests and for diagnostics."""
    return _active_meter.get()
