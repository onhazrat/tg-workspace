"""The Channel Directory: what we know about a handle (IDEA-011 D9, D16).

The corpus-wide map of every Channel anyone has seen referenced, followed or
not. One row per handle, holding what a fetch of `t.me/s/<handle>` said about
it: its followability verdict and its metadata.

It began as a triage cache, and that is still its first job. A Discover report
surfaces every handle its posts point at, and most of those are not channels
anyone could follow — bots, personal accounts, groups, and private or deleted
channels are all referenced from posts exactly the way real channels are. One
fetch per handle answers that automatically instead of by hand on every report.

Ticket 01 renamed it from `discover_probes`, because the table was named for the
job that filled it rather than for what it holds. It is **corpus-scoped and
outlives every Follow** (`tenancy.SCOPES`): what exists on Telegram is not a
fact about anybody's reading, so nothing here is deleted because an account
followed or unfollowed something. `tg_channels` remains the separate, follow-
scoped record of a Channel somebody actually syncs.

Deliberately kept apart from `discover_ignored`:

* A **dismissal** is a judgement — "not interesting to me".
* A **probe** is a fact about the handle — "cannot be followed by anyone".

They are surfaced as two separate views for the same reason. Folding them
together would make an automated verdict indistinguishable from a deliberate
one, and would let a mistaken probe pass for something the operator chose.

Like `isFollowed` and `isIgnored`, a probe is joined onto candidates at read
time rather than frozen into the stored report: the report is a record of what
was referenced, while a handle's nature is current state that should correct
itself across every saved report at once.

## The verdict rule

`record_probe_result` writes `ok`/`unavailable` **only** when a Telegram page
actually parsed. Everything else — timeouts, HTTP errors, a proxy handing back
a block page — records `unknown` and bumps `attempts`.

This is the single most important rule here. Because a conclusive answer is
cached indefinitely, writing a verdict from a failed fetch would permanently
hide a real channel from every future report, with nothing on screen to hint
that anything went wrong. An `unknown` costs a retry; a wrong `unavailable`
costs a channel, silently.

## The table is also the queue

`enqueue_handles` / `dequeue_handles` treat a `status="unknown"` row as a pending
work item. The cache and the queue are the same row on purpose: two tables could
disagree about whether a handle still needs fetching, and the disagreement would
show up as either a handle probed twice or a handle probed never.

`dequeue_handles` takes no candidate list — it answers "what should be fetched
next" from the table alone. That is what allows probing to run as a scheduled
backend job (`app.jobs.discover_probe`) rather than being driven from a React
effect, which is where this logic used to live. The client had to supply the
handle list, so it also had to remember which handles it had already asked
about, chain the batches, and survive its own tab being closed. It could not do
the last one.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_
from sqlmodel import Session, col, select

from app.models_tg import DirectoryEntry, utc_now
from app.services.channel_directory_samples import replace_samples
from app.services.tenancy import unscoped_select

#: Why the probe reads below do not go through `scoped_select` (ticket 16).
#:
#: Named once and passed to both, so the two cannot drift into stating
#: different reasons for the same decision — and so the decision is one string
#: to change if it is ever revisited.
PROBE_SCOPE_REASON = (
    "A probe is a fact about a handle, not about an account: "
    "'@foo cannot be followed by anyone' has the same answer for every caller, "
    "so `DirectoryEntry` is classified `Scope.CORPUS` in "
    "`services/tenancy.py`. Scoping it would make each account re-probe every "
    "handle, multiplying fetches at Telegram by the number of accounts to "
    "arrive at the same verdict — and the queue is drained by a scheduled job "
    "with no user at all, which is the same reason `jobs/discover_probe.py` is "
    "deliberately unmetered by the quota ledger. The row carries no owner and "
    "nothing about it is private: it holds a public handle and what one fetch "
    "of that public page said."
)

#: Statuses that mean "Telegram answered, and this is the answer".
CONCLUSIVE_STATUSES = frozenset({"ok", "unavailable"})

PROBE_STATUSES = frozenset({"ok", "unavailable", "unknown"})
PROBE_KINDS = frozenset({"channel", "group", "bot", "user", "unknown"})

#: How long to wait before re-probing a handle that keeps failing.
#:
#: Doubles per consecutive failure and stops growing at a day: a handle that
#: has failed eight times in a row is probably failing for a reason a tighter
#: loop will not fix, and the sweep should not keep spending proxy lanes on it.
RETRY_BACKOFF_BASE_MINUTES = 15
RETRY_BACKOFF_MAX_MINUTES = 24 * 60

#: Priority for a row nothing has ranked. Large rather than 0 so a handle
#: enqueued with a real candidate rank always sorts ahead of one that was not.
DEFAULT_PROBE_PRIORITY = 1_000_000

#: A manual recheck jumps the queue. The operator is looking at that row, and a
#: recheck that waited behind a freshly generated report would take minutes.
RECHECK_PRIORITY = 0

DEFAULT_PROBE_PAGE_SIZE = 200
MAX_PROBE_PAGE_SIZE = 1000


def normalize_handle(name: str) -> str:
    """Mirrors `discover.normalize_handle` — the key must match candidate names."""
    return name.lstrip("@").strip().lower()


def _retry_deadline(attempts: int, *, now: datetime) -> datetime:
    """When a handle that just failed becomes eligible for another attempt.

    Stored on the row rather than recomputed at read time so the dequeue stays a
    single indexable comparison. `attempts` is the count *including* the failure
    being recorded, so the first failure waits one base interval.
    """
    minutes = min(
        RETRY_BACKOFF_BASE_MINUTES * (2 ** max(attempts - 1, 0)),
        RETRY_BACKOFF_MAX_MINUTES,
    )
    return now + timedelta(minutes=minutes)


def probe_to_camel(row: DirectoryEntry) -> dict[str, Any]:
    return {
        "handle": row.handle,
        "status": row.status,
        "kind": row.kind,
        "displayName": row.display_name,
        "bio": row.bio,
        "subscribers": row.subscribers,
        "photos": row.photos,
        "videos": row.videos,
        "files": row.files,
        "links": row.links,
        "telegramChatId": row.telegram_chat_id,
        "photoUrl": row.photo_url,
        "attempts": row.attempts,
        "lastError": row.last_error,
        "checkedAt": (
            int(row.checked_at.timestamp() * 1000) if row.checked_at else None
        ),
    }


def probe_map(session: Session, handles: set[str]) -> dict[str, dict[str, Any]]:
    """Probes for the given handles, keyed by handle, for the read-time join.

    Scoped to the handles asked about rather than loading the whole table: the
    probe cache is global and grows across every report ever generated, while a
    single report only needs its own candidates.

    Rows that have never been attempted are omitted. Since this table doubles as
    the work queue, enqueuing a report's candidates creates a row for every one
    of them immediately — but a queue entry is not an answer, and a candidate
    waiting its turn must keep reading as "not checked yet" rather than as an
    inconclusive result. Callers rely on a missing entry meaning exactly that.
    """
    if not handles:
        return {}
    statement = unscoped_select(
        select(DirectoryEntry).where(
            col(DirectoryEntry.handle).in_(handles),
            col(DirectoryEntry.attempted_at).is_not(None),
        ),
        reason=PROBE_SCOPE_REASON,
    )
    return {row.handle: probe_to_camel(row) for row in session.exec(statement).all()}


def list_probes(
    session: Session,
    *,
    status: str | None = None,
    limit: int = DEFAULT_PROBE_PAGE_SIZE,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """One page of probe rows, ordered by handle.

    Paged rather than whole-table: this cache grows across every report ever
    generated and is never pruned, so an unbounded select here would get slower
    for the lifetime of the install (`docs/unbounded-query-audit.md`).
    """
    statement = unscoped_select(select(DirectoryEntry), reason=PROBE_SCOPE_REASON)
    if status:
        statement = statement.where(col(DirectoryEntry.status) == status)
    statement = (
        statement.order_by(col(DirectoryEntry.handle)).offset(offset).limit(limit)
    )
    return [probe_to_camel(row) for row in session.exec(statement).all()]


def queue_counts(session: Session) -> dict[str, int]:
    """Queue state for the progress display, as four indexed counts.

    Deliberately global rather than scoped to one report: scoping would mean
    loading that report's candidate blob on every poll, and the blob is the
    corpus-sized column. In practice the queue is dominated by the newest report
    anyway, because a resolved handle never re-enters it.

    `queued` and `retrying` are split because they behave differently on screen:
    `queued` drains to zero and can drive a progress bar, while `retrying` may
    never reach zero — a permanently unreachable handle keeps retrying at the
    backoff ceiling forever, by design.
    """
    unknown = col(DirectoryEntry.status) == "unknown"
    attempts = col(DirectoryEntry.attempts)

    def _count(clause: Any) -> int:
        statement = unscoped_select(
            select(func.count()).select_from(DirectoryEntry).where(clause),
            reason=PROBE_SCOPE_REASON,
        )
        return int(session.exec(statement).one())

    return {
        "queued": _count(and_(unknown, attempts == 0)),
        "retrying": _count(and_(unknown, attempts > 0)),
        "resolved": _count(col(DirectoryEntry.status) == "ok"),
        "unavailable": _count(col(DirectoryEntry.status) == "unavailable"),
    }


def enqueue_handles(session: Session, handles: list[str]) -> int:
    """Queue `handles` for probing, in the order given, and return how many.

    Pass candidates ranked strongest-first: the index in the list becomes the
    row's `priority`, which is the drain order. A handle already queued from an
    earlier report keeps the *better* of the two ranks, so appearing near the top
    of any report is enough to be probed early.

    Handles with a conclusive verdict are skipped entirely — that cache is the
    reason a second report over overlapping channels costs almost nothing.
    """
    ranked: dict[str, int] = {}
    for rank, raw in enumerate(handles):
        handle = normalize_handle(raw)
        if not handle or handle in ranked:
            continue
        ranked[handle] = rank
    if not ranked:
        return 0

    existing = {
        row.handle: row
        for row in session.exec(
            select(DirectoryEntry).where(col(DirectoryEntry.handle).in_(set(ranked)))
        ).all()
    }

    queued = 0
    for handle, rank in ranked.items():
        row = existing.get(handle)
        if row is None:
            session.add(
                DirectoryEntry(
                    handle=handle,
                    status="unknown",
                    priority=rank,
                    created_at=utc_now(),
                )
            )
            queued += 1
            continue
        if row.status in CONCLUSIVE_STATUSES:
            continue
        if rank < row.priority:
            row.priority = rank
            session.add(row)
    session.commit()
    return queued


def dequeue_handles(
    session: Session, *, limit: int, now: datetime | None = None
) -> list[str]:
    """The next batch to probe, best-ranked first. **A pure read.**

    Takes no candidate list: the queue answers this from the table alone, which
    is what lets a scheduled job drain it whether or not anyone has the Discover
    tab open. A handle whose backoff has not elapsed is not due, and one with a
    verdict is not pending, so both fall out of the WHERE rather than needing a
    second pass.

    **It briefly held a lease and does not any more.** Ticket 36 moved the fetch
    out of the tick that selects the work, so for a while every tick re-selected
    the handles the previous one had queued; a `retry_after` lease was the first
    answer. The lease had no holder — a message sitting on a lane is claimed by
    nobody — so it could not be renewed, and a probe starved behind sync work
    for longer than the lease was enqueued a second time. It also made
    `retry_after` mean two things depending on which writer set it.

    The sweep gates on the lane being **empty** instead, so a handle that is
    already queued or in flight cannot be selected at all: emptiness is the
    lane's own answer to "what is outstanding", and it needs no second copy in
    this table. See `discover_probe.run_discover_probe_sweep`.
    """
    if limit <= 0:
        return []
    moment = now or utc_now()
    statement = (
        select(DirectoryEntry)
        .where(
            col(DirectoryEntry.status) == "unknown",
            or_(
                col(DirectoryEntry.retry_after).is_(None),
                col(DirectoryEntry.retry_after) <= moment,
            ),
        )
        .order_by(col(DirectoryEntry.priority), col(DirectoryEntry.handle))
        .limit(limit)
    )
    return [row.handle for row in session.exec(statement).all()]


def handles_needing_probe(
    session: Session, handles: list[str], *, now: datetime | None = None
) -> list[str]:
    """Which of `handles` are still pending, input order preserved.

    The same predicate as `dequeue_handles`, but scoped to a caller-supplied set
    rather than the whole queue — used to answer "is there anything left to do
    for *this* report" without draining anything.

    Skipped: handles with a conclusive verdict (cached indefinitely — a bot does
    not become a channel), and handles whose retry backoff has not elapsed.
    """
    moment = now or utc_now()
    wanted = [h for h in (normalize_handle(x) for x in handles) if h]
    if not wanted:
        return []

    existing = {
        row.handle: row
        for row in session.exec(
            select(DirectoryEntry).where(col(DirectoryEntry.handle).in_(set(wanted)))
        ).all()
    }

    out: list[str] = []
    seen: set[str] = set()
    for handle in wanted:
        if handle in seen:
            continue
        seen.add(handle)
        row = existing.get(handle)
        if row is None:
            out.append(handle)
            continue
        if row.status in CONCLUSIVE_STATUSES:
            continue
        if row.retry_after is None or row.retry_after <= moment:
            out.append(handle)
    return out


def _get_or_create(session: Session, handle: str) -> DirectoryEntry:
    row = session.get(DirectoryEntry, handle)
    if row is None:
        row = DirectoryEntry(handle=handle, created_at=utc_now())
        session.add(row)
    return row


def record_probe_result(
    session: Session,
    handle: str,
    info: dict[str, Any] | None,
    *,
    error: str | None = None,
) -> dict[str, Any]:
    """Store the outcome of one fetch.

    Pass `info` as the `get_channel_info` payload on success, or `None` with an
    `error` when the fetch raised. A payload that did not come from a Telegram
    page (`isTelegramPage` false) is treated as a failure regardless of what
    else it contains — see the module docstring.
    """
    key = normalize_handle(handle)
    row = _get_or_create(session, key)
    now = utc_now()
    row.attempted_at = now

    inconclusive = info is None or not info.get("isTelegramPage")
    if inconclusive:
        row.status = "unknown"
        row.attempts += 1
        row.last_error = error or "no telegram page in response"
        # Stays queued, but not due again until the backoff elapses.
        row.retry_after = _retry_deadline(row.attempts, now=now)
        session.commit()
        session.refresh(row)
        return probe_to_camel(row)

    payload: dict[str, Any] = info or {}
    row.status = "unavailable" if payload.get("isUnavailableOnWebView") else "ok"
    kind = str(payload.get("kind") or "unknown")
    row.kind = kind if kind in PROBE_KINDS else "unknown"
    row.display_name = payload.get("displayName") or None
    row.bio = payload.get("bio") or None
    row.subscribers = payload.get("subscribers") or None
    row.photos = payload.get("photos") or None
    row.videos = payload.get("videos") or None
    row.files = payload.get("files") or None
    row.links = payload.get("links") or None
    # `or None` on the four above collapses a missing counter and an empty
    # string together, which is right: Telegram omits a counter it has none of,
    # and `""` would make "no photos" and "we did not look" the same value.
    # The chat id is an int, so it is checked by type instead — `or None` would
    # turn a legitimate 0 into a missing one.
    #
    # **It is only ever written, never cleared**, which is the one place this
    # function does not simply overwrite what it knows. The id is decoded from a
    # message widget, so a page with no visible messages yields none — and an
    # `unavailable` verdict is synthesized with no page at all
    # (`jobs/discover_probe.py`). Overwriting would drop the id exactly when the
    # channel went private or was renamed, which is the one case it is for: it
    # is the only identity that survives a handle rename. A recheck still clears
    # it, because `requeue_probes` discards the whole verdict deliberately.
    #
    # The four counters above are overwritten, and that asymmetry is the point.
    # A counter is a snapshot of a page and a stale one is a lie; the chat id is
    # immutable, so a remembered one stays true however the page changed.
    chat_id = payload.get("telegramChatId")
    if isinstance(chat_id, int):
        row.telegram_chat_id = chat_id
    row.photo_url = payload.get("photoUrl") or None
    row.latest_id = int(payload.get("latestId") or 0)
    # **A payload with no `samples` key is not an empty sample set** (ticket 02).
    # It came from a fetch that never parsed the preview page's Posts, which
    # says nothing about them, so the existing snapshot is left alone. An empty
    # list *is* an answer and clears it — which is what an `unavailable` verdict
    # looks like, since a page with no readable messages has no recent Posts.
    #
    # The distinction is the same shape as the chat id's above and becomes
    # load-bearing for the same reason: sync fetches this metadata and never
    # parses samples, so once it feeds the Directory every followed Channel
    # would otherwise have its snapshot wiped on every sync.
    #
    # Replace rather than merge, inside this transaction rather than after it:
    # a verdict stored without its samples is a row claiming `ok` beside the
    # previous probe's snapshot. See `channel_directory_samples`.
    samples = payload.get("samples")
    if isinstance(samples, list):
        replace_samples(session, key, samples, captured_at=now)
    # A conclusive answer clears the failure history: the backoff exists to
    # throttle retries of an unresolved handle, and this one is now resolved.
    row.attempts = 0
    row.last_error = None
    row.retry_after = None
    row.checked_at = now
    session.commit()
    session.refresh(row)
    return probe_to_camel(row)


def requeue_probes(
    session: Session, handles: list[str], *, priority: int = RECHECK_PRIORITY
) -> list[str]:
    """Discard the cached answer and put the handle back at the front — recheck.

    Note this *requeues* rather than merely forgetting. Under the queue model a
    row is both the cached answer and the work item, so deleting it would take
    the handle out of the queue entirely and nothing would ever fetch it again.
    The row has to be reset in place: cleared of its verdict, and re-marked
    pending at `priority` so the next drain tick picks it up first.

    **The samples are deliberately left alone.** A recheck says the verdict is
    stale, not that the snapshot is wrong, and clearing it here would blank the
    one part of the entry worth reading for however long the queue takes to
    reach the handle. The next conclusive probe replaces them wholesale.

    Returns every handle now queued, including ones that had never been probed —
    the UI offers recheck on rows whose verdict has not arrived yet, and asking
    for a handle nobody has looked at is a reasonable thing to do, not an error.
    """
    requeued: list[str] = []
    for raw in handles:
        handle = normalize_handle(raw)
        if not handle or handle in requeued:
            continue
        row = _get_or_create(session, handle)
        row.status = "unknown"
        row.kind = "unknown"
        row.display_name = None
        row.bio = None
        row.subscribers = None
        row.photos = None
        row.videos = None
        row.files = None
        row.links = None
        row.telegram_chat_id = None
        row.photo_url = None
        row.latest_id = 0
        row.attempts = 0
        row.last_error = None
        row.checked_at = None
        row.attempted_at = None
        row.retry_after = None
        row.priority = priority
        session.add(row)
        requeued.append(handle)
    session.commit()
    return requeued
