"""Records every Request the app makes to Telegram (RQS-01, ADR-035).

The quota meter (`core/request_meter.py`) counts the attempts a Budget pays
for. This records **every attempt that reached the network**, on any Telegram
host, with what the Requests tab needs to say where it went: which kind of work
made it, the Account, the Channel, the Lane, the page type, how long it took and
whether it was Useful, Idle or Wasted.

Two things meet here, the same two the meter joins. `network.fetch_with_retry`
knows an attempt happened and how it ended; the sync knows whose work it was
and, after the page is applied, whether it brought anything new. They meet
through `contextvars`, for the meter's reason: a parameter threaded through the
scraper into the HTTP client would be read by nobody on the way.

* **Attribution** (`attributed`) is set by the work: kind, Account, Budget,
  Channel, best-effort. Nested blocks refine the outer one, so the lane consumer
  can say "best-effort" and the sync below it say which Channel. Work that sets
  none records kind "other".
* **A page** (`page`) is one page fetch, across `fetch_with_retry`'s own
  retries and the outer retries of the code that asked for the page. Its
  attempts share a chain id (the first attempt's id) and an attempt number.
  The answered attempt waits in the page until the page closes, because only
  then does the caller know how many Posts were new: `report_posts` says so.
  A fetch outside any page, and every picture, is a page of its own.

Closed records go into a buffer for this process, which
`services/request_stats.flush_recorded_requests` drains into the database: in
the `finally` that writes the ledger, every few seconds, and on shutdown. Kept
in `core/` with no database in it, for the reason the meter is.
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
    #: No work declared itself. A known path recording this is a bug.
    OTHER = "other"


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


@dataclass
class Page:
    """One page fetch and every attempt it took. See the module docstring."""

    page_type: PageType
    chain_id: uuid.UUID | None = None
    attempts: int = 0
    _answered: list[RequestRecord] = field(default_factory=list)
    _new_posts: int | None = None
    _repeated_posts: int | None = None

    def report_posts(self, new: int, repeated: int) -> None:
        """How many Posts on the page were new, and how many we already had."""
        self._new_posts = new
        self._repeated_posts = repeated

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
    ) -> None:
        """One attempt that reached the network. `cause` is `None` on success."""
        who = _attribution.get()
        record_id = uuid.uuid4()
        if self.chain_id is None:
            self.chain_id = record_id
        self.attempts += 1
        record = RequestRecord(
            id=record_id,
            at=at,
            latency_ms=latency_ms,
            kind=who.kind.value,
            # The ledger's rule (ticket 08): an answered web view attempt of
            # work charged to a Budget. Pictures, transport faults and
            # unbudgeted work are Uncharged.
            charged=web_view and answered and who.budget is not None,
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
        )
        if cause is None and self is _page.get():
            # Judged when the page closes, once the caller knows what it brought.
            self._answered.append(record)
        else:
            _push([record])

    def _close(self) -> None:
        # Only the last answered attempt carries the page's Posts; an earlier
        # answer the caller asked again after is Idle.
        if self._answered and self._new_posts is not None:
            last = self._answered[-1]
            last.new_posts = self._new_posts
            last.repeated_posts = self._repeated_posts
            if self._new_posts > 0:
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

_buffer: list[RequestRecord] = []
_buffer_lock = threading.Lock()


def _push(records: list[RequestRecord]) -> None:
    if records:
        with _buffer_lock:
            _buffer.extend(records)


def drain() -> list[RequestRecord]:
    """Take every closed record out of the buffer. Thread-safe: flushes run off the loop."""
    global _buffer
    with _buffer_lock:
        taken, _buffer = _buffer, []
    return taken


@contextmanager
def attributed(
    *,
    kind: RequestKind | None = None,
    account_id: uuid.UUID | None = None,
    budget: str | None = None,
    channel: str | None = None,
    best_effort: bool | None = None,
) -> Iterator[None]:
    """Attribute the Requests made inside this block, refining any outer block."""
    current = _attribution.get()
    token = _attribution.set(
        replace(
            current,
            kind=kind if kind is not None else current.kind,
            account_id=account_id if account_id is not None else current.account_id,
            budget=budget if budget is not None else current.budget,
            channel=channel if channel is not None else current.channel,
            best_effort=best_effort if best_effort is not None else current.best_effort,
        )
    )
    try:
        yield
    finally:
        _attribution.reset(token)


@contextmanager
def page(page_type: PageType) -> Iterator[Page]:
    """One page fetch, however many attempts and retry layers it takes."""
    opened = Page(page_type)
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
