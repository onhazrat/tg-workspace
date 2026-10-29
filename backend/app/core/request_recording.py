"""Records every Request the app makes to Telegram (RQS-01, ADR-035).

This records **every attempt that reached the network**, on any Telegram
host, with what the Requests tab needs to say where it went: which kind of work
made it, the Account, the Channel, the Lane, the page type, how long it took and
whether it was Useful, Idle or Wasted. It also counts what the work pays for
(ADR-041): the tally beside the attribution.

Two things meet here. `network.fetch_with_retry` knows an attempt happened and
how it ended; the work knows whose it was and, after the page is applied,
whether it brought anything new. They meet through `contextvars`, because a
parameter threaded through the scraper into the HTTP client would be read by
nobody on the way, and because two syncs for two Accounts overlap routinely:
`asyncio` copies the context into each task, so the tasks one piece of work
spawns share its attribution and tally while work beside it keeps its own.

* **Attribution** (`attributed`) says whose work the Requests are: kind,
  Account, Budget, Channel, best-effort, job. Kind, Account, Budget and job are
  set only by `services/request_accounting.py` when it opens Accounted work, so
  the record and the ledger cannot name two different payers (a guard walks the
  AST for it). Anyone may refine the Channel and best-effort inside open work.
  Work that sets nothing records kind "other".
* **The tally** (`tallied`) counts the attempts the work pays for, under the one
  charge rule in `Page.record`: an answered web view attempt. With a Budget that
  is exactly the records marked Charged; a probe counts by the same rule into
  the Directory's tally, with no Budget. No tally open means nothing counts.
* **A page** (`page`) is one page fetch, across `fetch_with_retry`'s own
  retries and the outer retries of the code that asked for the page. Its
  attempts share a chain id (the first attempt's id) and an attempt number.
  The answered attempt waits in the page until the page closes, because only
  then does the caller know how many Posts were new: `report_posts` says so.
  A fetch outside any page, and every picture, is a page of its own.

Closed records go into a buffer for this process, which
`services/request_stats.flush_recorded_requests` drains into the database: in
the `finally` that writes the ledger, every few seconds, and on shutdown. Kept
in `core/` because it is infrastructure with no database and no domain in it,
the reason `async_db.py` is a declared exception in `test_service_kinds.py`.
"""

from __future__ import annotations

import contextvars
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum
from urllib.parse import urlsplit


class RequestKind(StrEnum):
    """The work a Request was made for. Stored, so the values are a format."""

    AUTO = "auto"
    BULK = "bulk"
    SINGLE = "single"
    #: A bulk follow's handle checks, charged to manual bulk (RQS-14).
    FOLLOW = "follow"
    #: A Directory probe (RQS-12): no Account, no Budget, the handle it probed.
    PROBE = "probe"
    #: A handle checked from the API for whoever asked: Uncharged (RQS-14).
    HANDLE = "handle"
    #: A call to the Bot API: publishing, bot info, bot files. Uncharged.
    BOT_API = "botApi"
    #: No work declared itself. A known path recording this is a bug.
    OTHER = "other"


#: Every kind an Operator can disable (RKD-01, ADR-040). `other` is the bug
#: bucket: switching it off would hide an attribution bug, not stop work.
SWITCHABLE_KINDS: tuple[RequestKind, ...] = tuple(
    kind for kind in RequestKind if kind is not RequestKind.OTHER
)

#: What a person reads for each switchable kind; the Requests tab's labels.
KIND_LABELS: dict[RequestKind, str] = {
    RequestKind.AUTO: "Auto sync",
    RequestKind.BULK: "Manual bulk",
    RequestKind.SINGLE: "Manual single",
    RequestKind.FOLLOW: "Follow",
    RequestKind.PROBE: "Directory probe",
    RequestKind.HANDLE: "Handle check",
    RequestKind.BOT_API: "Bot API",
}


def kind_refusal(kind: RequestKind) -> str:
    """The one message a refusal of a disabled kind reads, wherever it is met."""
    return f"{KIND_LABELS[kind]} is disabled on this deployment"


class RequestKindDisabled(Exception):
    """Work of a kind the Operator disabled (RKD-01, ADR-040).

    Raised before an attempt leaves, so it is not a Request and not a network
    error: a caller that retries network errors must not retry this, and a
    sync that meets it is held, not failed.
    """

    def __init__(self, kind: RequestKind) -> None:
        super().__init__(kind_refusal(kind))
        self.kind = kind


class PageType(StrEnum):
    POSTS = "posts"
    MEDIA = "media"
    METADATA = "metadata"


class Outcome(StrEnum):
    USEFUL = "useful"
    IDLE = "idle"
    WASTED = "wasted"


class Cause(StrEnum):
    """Why a Request was Wasted: proxy pacing's classes, by their own answer."""

    TURNED_AWAY = "turnedAway"
    SOFT_BLOCK = "softBlock"
    ANSWERED_ERROR = "answeredError"
    TRANSPORT_FAULT = "transportFault"
    #: A probe of a handle that does not exist (RQS-12). See `page`.
    MISSING_HANDLE = "missingHandle"


#: The Lane of a deployment with no proxies. Same spelling as
#: `network_settings.DIRECT_EGRESS_KEY`, which this module cannot import.
DIRECT_LANE = "direct"


def lane_label(proxy_url: str | None) -> str:
    """`host:port` of a proxy with its credentials and scheme stripped, or `direct`."""
    if not proxy_url or proxy_url == DIRECT_LANE:
        return DIRECT_LANE
    parts = urlsplit(proxy_url if "://" in proxy_url else f"//{proxy_url}")
    host = parts.hostname or "unknown"
    return f"{host}:{parts.port}" if parts.port else host


@dataclass(frozen=True)
class Attribution:
    """Whose work the Requests in this block are. Frozen: blocks refine copies."""

    kind: RequestKind = RequestKind.OTHER
    account_id: uuid.UUID | None = None
    budget: str | None = None
    channel: str | None = None
    best_effort: bool = False
    #: The sync or follow job whose charge pays for this work: the ledger
    #: charges a job once, on the day it ends (RQS-15).
    job_id: str | None = None


@dataclass
class Tally:
    """The attempts one piece of Accounted work pays for. See `tallied`.

    Mutable and shared on purpose: the `ContextVar` holds a reference, so a
    child task counting into it counts into its parent's work. Rebinding the
    variable to a fresh value instead would give each task its own count and
    the work would pay for nothing.
    """

    requests: int = 0


@dataclass
class RequestRecord:
    """One Request, as `tg_request_records` stores it."""

    id: uuid.UUID
    at: datetime
    latency_ms: int
    kind: str
    charged: bool
    account_id: uuid.UUID | None
    budget: str | None
    best_effort: bool
    channel: str | None
    lane: str
    page_type: str
    outcome: str
    cause: str | None
    error_code: str | None
    attempt: int
    chain_id: uuid.UUID
    new_posts: int | None = None
    repeated_posts: int | None = None
    #: Set on one Request of each sync run: whether that sync failed (RQS-04).
    #: `None` on every other Request. See `sync_run`.
    sync_failed: bool | None = None
    job_id: str | None = None


@dataclass
class Page:
    """One page fetch and every attempt it took. See the module docstring."""

    page_type: PageType
    #: What a soft block means on this page. See `page`.
    soft_block: Cause = Cause.SOFT_BLOCK
    chain_id: uuid.UUID | None = None
    attempts: int = 0
    _answered: list[RequestRecord] = field(default_factory=list)
    _new_posts: int | None = None
    _repeated_posts: int | None = None
    _changed: bool = False

    def report_posts(self, new: int, repeated: int, *, changed: bool = False) -> None:
        """How many Posts on the page were new, and how many we already had.

        `changed` says applying the page wrote something besides new Posts: a
        stored Post's counters or text, or the Channel's metadata (RQS-11).
        """
        self._new_posts = new
        self._repeated_posts = repeated
        self._changed = changed

    def record(
        self,
        *,
        at: datetime,
        latency_ms: int,
        lane: str,
        web_view: bool,
        cause: Cause | None,
        error_code: str | None,
        answered: bool,
        private: bool = False,
    ) -> None:
        """One attempt that reached the network. `cause` is `None` on success.

        `private` says a soft-blocked page was a private Channel's own (RQS-13).
        """
        who = _attribution.get()
        if cause is Cause.SOFT_BLOCK:
            cause, error_code = self._soft_blocked(error_code, private=private)
        record_id = uuid.uuid4()
        if self.chain_id is None:
            self.chain_id = record_id
        self.attempts += 1
        # The one charge rule (ticket 08, ADR-041): an answered web view
        # attempt is paid for, a 404, a 429 and a soft block included.
        # Pictures, Bot API calls and transport faults are not. With a Budget
        # it is Charged, and the tally counts exactly those records; a probe's
        # tally counts by the same rule with no Budget.
        paid = web_view and answered
        tally = _tally.get()
        if paid and tally is not None:
            tally.requests += 1
        record = RequestRecord(
            id=record_id,
            at=at,
            latency_ms=latency_ms,
            kind=who.kind.value,
            charged=paid and who.budget is not None,
            account_id=who.account_id,
            budget=who.budget,
            best_effort=who.best_effort,
            channel=who.channel,
            lane=lane,
            page_type=self.page_type.value,
            outcome=Outcome.WASTED.value if cause is not None else Outcome.IDLE.value,
            cause=cause.value if cause is not None else None,
            error_code=error_code,
            attempt=self.attempts,
            chain_id=self.chain_id,
            job_id=who.job_id,
        )
        if cause is None and self is _page.get():
            # Judged when the page closes, once the caller knows what it brought.
            self._answered.append(record)
        else:
            _push([record])

    def _soft_blocked(
        self, error_code: str | None, *, private: bool
    ) -> tuple[Cause | None, str | None]:
        # A page asking whether a handle exists has its answer in a private
        # Channel's page: it does. An answer, judged when the page closes.
        if private and self.soft_block is Cause.MISSING_HANDLE:
            return None, None
        return self.soft_block, error_code

    def _close(self) -> None:
        # Only the last answered attempt carries the page's Posts; an earlier
        # answer the caller asked again after is Idle.
        if self._answered and self._new_posts is not None:
            last = self._answered[-1]
            last.new_posts = self._new_posts
            last.repeated_posts = self._repeated_posts
            if self._new_posts > 0 or self._changed:
                last.outcome = Outcome.USEFUL.value
        _push(self._answered)
        self._answered = []


#: The default is frozen, so sharing one instance is safe.
_attribution: contextvars.ContextVar[Attribution] = contextvars.ContextVar(
    "tg_request_attribution",
    default=Attribution(),  # noqa: B039
)
_page: contextvars.ContextVar[Page | None] = contextvars.ContextVar(
    "tg_request_page", default=None
)
_tally: contextvars.ContextVar[Tally | None] = contextvars.ContextVar(
    "tg_request_tally", default=None
)

_buffer: list[RequestRecord] = []
_buffer_lock = threading.Lock()


def _push(records: list[RequestRecord]) -> None:
    run = _sync.get()
    if run is not None:
        records = run.hold(records)
    if records:
        with _buffer_lock:
            _buffer.extend(records)


@dataclass
class SyncRun:
    """One sync of one Channel, counted on one of its Requests (RQS-04).

    Whether a sync failed is known only when it ends, so one of its Requests
    waits here until then and carries the answer: the first charged one, or
    the first at all when none is charged. A charged one keeps the sync under
    the Charged choice and the Account picked, which a refused first attempt
    (Uncharged) would not. A sync that made no Request counts nowhere.
    """

    who: Attribution
    failed: bool = False
    held: RequestRecord | None = None
    closed: bool = False

    def hold(self, records: list[RequestRecord]) -> list[RequestRecord]:
        """`records` less the one this sync keeps back, and any it lets go."""
        if self.closed:
            return records
        out: list[RequestRecord] = []
        for record in records:
            mine = (record.kind, record.channel) == (
                self.who.kind.value,
                self.who.channel,
            )
            if mine and (
                self.held is None or (record.charged and not self.held.charged)
            ):
                if self.held is not None:
                    out.append(self.held)
                self.held = record
            else:
                out.append(record)
        return out

    def close(self) -> None:
        self.closed = True
        if self.held is not None:
            self.held.sync_failed = self.failed
            _push([self.held])
            self.held = None


_sync: contextvars.ContextVar[SyncRun | None] = contextvars.ContextVar(
    "tg_request_sync", default=None
)


@contextmanager
def sync_run() -> Iterator[SyncRun]:
    """One sync of the Channel attributed around it; set `failed` before it ends.

    An exception leaving the block fails the sync, except a disabled kind's
    refusal: that sync is held and resumes later (RKD-01).
    """
    run = SyncRun(_attribution.get())
    token = _sync.set(run)
    try:
        yield run
    except RequestKindDisabled:
        raise
    except Exception:
        run.failed = True
        raise
    finally:
        _sync.reset(token)
        run.close()


def drain() -> list[RequestRecord]:
    """Take every closed record out of the buffer. Thread-safe: flushes run off the loop."""
    global _buffer
    with _buffer_lock:
        taken, _buffer = _buffer, []
    return taken


def current_kind() -> RequestKind:
    """The kind of work the Requests made here would be recorded under."""
    return _attribution.get().kind


@contextmanager
def attributed(
    *,
    kind: RequestKind | None = None,
    account_id: uuid.UUID | None = None,
    budget: str | None = None,
    channel: str | None = None,
    best_effort: bool | None = None,
    job_id: str | None = None,
) -> Iterator[None]:
    """Attribute the Requests made inside this block, refining any outer block.

    Outside `services/request_accounting.py` only `channel` and `best_effort`
    may be passed: kind, Account, Budget and job belong to the Accounted work
    that pays (ADR-041). `tests/services/test_request_accounting.py` guards it.
    """
    current = _attribution.get()
    token = _attribution.set(
        replace(
            current,
            kind=kind if kind is not None else current.kind,
            account_id=account_id if account_id is not None else current.account_id,
            budget=budget if budget is not None else current.budget,
            channel=channel if channel is not None else current.channel,
            best_effort=best_effort if best_effort is not None else current.best_effort,
            job_id=job_id if job_id is not None else current.job_id,
        )
    )
    try:
        yield
    finally:
        _attribution.reset(token)


@contextmanager
def tallied() -> Iterator[Tally]:
    """Count the attempts the work inside this block pays for. See `Tally`."""
    tally = Tally()
    token = _tally.set(tally)
    try:
        yield tally
    finally:
        _tally.reset(token)


@contextmanager
def page(
    page_type: PageType, *, soft_block: Cause = Cause.SOFT_BLOCK
) -> Iterator[Page]:
    """One page fetch, however many attempts and retry layers it takes.

    `soft_block` is the cause a page withholding its messages records. A probe
    asks whether a handle exists, so for it that page answers no:
    `Cause.MISSING_HANDLE` (RQS-12), unless the page is a private Channel's:
    then the handle exists, and the page is an answer (RQS-13).
    """
    opened = Page(page_type, soft_block)
    token = _page.set(opened)
    try:
        yield opened
    finally:
        _page.reset(token)
        opened._close()


def page_for_fetch(*, media: bool) -> Page:
    """The page a `fetch_with_retry` call records into.

    A picture is always its own page: it is fetched inside a Posts page's block
    and must not join that page's chain. Anything else joins the open page, or
    is a page of its own when none is open.
    """
    current = _page.get()
    if current is not None and not media:
        return current
    return Page(PageType.MEDIA if media else PageType.METADATA)
