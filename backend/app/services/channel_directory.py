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
cached until its refresh window elapses — and for a dead verdict, for ever —
writing a verdict from a failed fetch would hide a real channel from every
report in between, with nothing on screen to hint that anything went wrong. An
`unknown` costs a retry; a wrong `unavailable` costs a channel, silently.

The rule now runs in both directions. A failed fetch of a handle we **already**
have an answer for keeps that answer, because refreshing re-fetches every live
entry on a window and one proxy timeout would otherwise blank a good entry
everywhere it is joined.

## An answer expires; the map does not

Ticket 03 made a conclusive answer stop being permanent. A **live** entry comes
due again after `directoryRefreshDays` — deployment policy, a week by default —
and that window is the Operator's primary rate control on outbound probe
traffic: widening it is the response to Telegram pushing back, short of turning
probing off. A **dead** verdict never comes due at all (`is_refreshable`), so
bots, groups, personal accounts and private or deleted channels stop costing
requests the moment they are answered once, however long the deployment runs.

`refresh_due_at` is a second column and deliberately not `retry_after`. That one
means "this fetch failed, back off"; this one means "this answer is old". Same
type, opposite cause, and the one time they were conflated it produced the
starvation `dequeue_handles` still documents.

The refresh has two other writers besides the window. `record_sync_metadata` is
fed by the sync orchestrator from the page it already fetched, so a followed
Channel stays current at zero extra requests; and `refresh_entries` marks an
entry due on demand — a **refresh**, which keeps the answer it is replacing,
as against a **recheck**, which discards it.

## The table is also the queue

`enqueue_handles` / `dequeue_handles` treat a `status="unknown"` row as a pending
work item — and, since ticket 03, a row whose `refresh_due_at` has passed as a
second kind of one. The cache and the queue are the same row on purpose: two tables could
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

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_
from sqlmodel import Session, col, select

from app.jobs.settings import load_directory_settings
from app.models_tg import DirectoryEntry, utc_now
from app.services.channel_directory_samples import replace_samples, samples_for
from app.services.directory_statistics import (
    SampleStatistics,
    compute_sample_statistics,
    media_density,
    media_mix,
)
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

#: A manual recheck or refresh jumps the queue. The operator is looking at that
#: row, and one that waited behind a freshly generated report would take minutes.
#:
#: **Negative, so it beats a rank rather than tying with one.** `enqueue_handles`
#: numbers a report's candidates from zero, so at `0` this sorted level with the
#: strongest candidate of the newest report and the tie fell to whichever handle
#: was alphabetically first. `test_recheck_jumps_the_queue` passed on exactly
#: that accident. Ticket 03 gave the constant a second caller — `refresh_entries`
#: — and the property has to hold by construction for both.
RECHECK_PRIORITY = -1

#: Priority for a handle the harvest sweep found in a stored Post (ticket 04).
#:
#: Behind `DEFAULT_PROBE_PRIORITY` and ahead of `REFRESH_PRIORITY`, which is the
#: ladder's own argument applied once more: a handle somebody's report named is
#: worth more than one nobody asked about, and one nobody asked about is still
#: an answer we have never had, which beats re-fetching an answer we hold.
#:
#: **One number for every harvested handle, not a rank**, and that is the
#: fairness mechanism the ticket asks for rather than a shrug. The sweep walks
#: the corpus with a single cursor and no idea who follows what, so the handles
#: it finds arrive in whatever order the Posts did; giving them all one priority
#: makes `dequeue_handles` fall through to its `handle` tiebreak, and an
#: alphabetical order cannot prefer one account's corpus over another's. Ranking
#: them by discovery order would hand the queue to whichever account's Channels
#: the cursor happened to be walking.
HARVEST_PRIORITY = 1_500_000

#: Priority for an entry that already has an answer and is only going stale.
#:
#: Larger than `DEFAULT_PROBE_PRIORITY`, so a scheduled refresh drains behind
#: every handle nobody has ever looked at: an answer we hold is worth less than
#: one we have never had. Set on the conclusive branch of `record_probe_result`
#: rather than left alone, because a row keeps the rank of whatever first
#: enqueued it — and a handle rechecked once carries `RECHECK_PRIORITY`, which
#: would put a week-old entry at the front of the queue for ever after.
REFRESH_PRIORITY = 2_000_000

#: Verdicts that never come due again (ticket 03).
#:
#: `status == "unavailable"` is private or deleted; these three are what the
#: page turned out to be. Both are facts a timer cannot change, and re-probing
#: them is the "bots and deleted channels cost requests forever" the refresh
#: window exists to bound. `channel` and `unknown` are the live kinds — an
#: unclassified page is refreshed on purpose, because the cost of being wrong is
#: one fetch a week and the cost of the other mistake is a Channel frozen at
#: whatever it looked like the first time.
DEAD_KINDS = frozenset({"bot", "group", "user"})

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


def resolve_refresh_window(session: Session) -> timedelta | None:
    """How long a live entry's answer stays current, or `None` for never.

    Read from the settings row rather than `config.py` directly, because the
    window is the Operator's lever: widening it is the documented response to
    Telegram pushing back, and a lever that needs a redeploy is not one. Zero
    disables refreshing entirely, which is the same convention every retention
    window in this deployment already uses.
    """
    days = load_directory_settings(session).get("directoryRefreshDays")
    if not isinstance(days, int) or days <= 0:
        return None
    return timedelta(days=days)


def is_refreshable(status: str, kind: str) -> bool:
    """Whether a verdict is one that can go stale.

    A live channel's subscriber count, its counters and what it publishes all
    move; whether a bot is a bot does not. Keeping the two apart is what makes
    the window bound the crawl instead of merely pacing it — the dead half of
    the Directory grows without ever costing another request.
    """
    return status == "ok" and kind not in DEAD_KINDS


def _epoch_ms(moment: datetime | None) -> int | None:
    """A `tg_*` timestamp on the wire.

    The tg tables store **naive** UTC (`models_tg.utc_now`), and
    `datetime.timestamp()` reads a naive value as *local* time, so the obvious
    `int(moment.timestamp() * 1000)` is off by the host's offset anywhere the
    container is not UTC. Attaching the timezone the column already means is
    what makes the two timestamps on this row agree with each other and with
    the database.
    """
    if moment is None:
        return None
    return int(moment.replace(tzinfo=UTC).timestamp() * 1000)


def probe_to_camel(row: DirectoryEntry) -> dict[str, Any]:
    counters = {
        "photos": row.photos,
        "videos": row.videos,
        "files": row.files,
        "links": row.links,
    }
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
        "checkedAt": _epoch_ms(row.checked_at),
        # The six stored statistics, straight off the row (ticket 02).
        # `None` is *not measured* everywhere, never zero.
        "lastPostAt": _epoch_ms(row.last_post_at),
        "sampleCount": row.sample_count,
        "postsPerWeek": row.posts_per_week,
        "medianViews": row.median_views,
        "forwardShare": row.forward_share,
        "script": row.script,
        # The two derived at read, from four columns already selected above
        # (ADR-015). Not stored, because a stored copy can disagree with its
        # own inputs and the derivation costs no join.
        "mediaMix": media_mix(counters),
        "mediaDensity": media_density(counters, row.latest_id),
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


def enqueue_handles(
    session: Session, handles: list[str], *, priority: int | None = None
) -> int:
    """Queue `handles` for probing, in the order given, and return how many.

    Pass candidates ranked strongest-first: the index in the list becomes the
    row's `priority`, which is the drain order. A handle already queued from an
    earlier report keeps the *better* of the two ranks, so appearing near the top
    of any report is enough to be probed early.

    `priority` overrides that ranking with one number for the whole batch, and
    the harvest sweep is why it exists (ticket 04). A harvested handle came out
    of a Post nobody asked a question about, so there is no rank to give it —
    and taking the index would be worse than arbitrary, since `enumerate` starts
    at zero and a report's strongest candidate is also zero. Every harvested
    handle carrying `HARVEST_PRIORITY` is also what keeps one account's corpus
    from starving another's out of the queue: at one priority the drain order
    falls through to `handle`, which knows nothing about who follows what.

    Handles with a conclusive verdict are skipped entirely — that cache is the
    reason a second report over overlapping channels costs almost nothing.
    """
    ranked: dict[str, int] = {}
    for rank, raw in enumerate(handles):
        handle = normalize_handle(raw)
        if not handle or handle in ranked:
            continue
        ranked[handle] = rank if priority is None else priority
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
            or_(
                # Pending: no answer yet, and any backoff from the last failure
                # has elapsed.
                and_(
                    col(DirectoryEntry.status) == "unknown",
                    or_(
                        col(DirectoryEntry.retry_after).is_(None),
                        col(DirectoryEntry.retry_after) <= moment,
                    ),
                ),
                # Stale: an answer we hold that has gone old (ticket 03). A
                # separate leg rather than a widened one, and it consults
                # `retry_after` not at all — a backoff left over from failures
                # *before* the handle resolved would otherwise hold its refresh
                # for as long as a day, which is the exact conflation the two
                # columns exist to prevent.
                col(DirectoryEntry.refresh_due_at) <= moment,
            ),
        )
        .order_by(col(DirectoryEntry.priority), col(DirectoryEntry.handle))
        .limit(limit)
    )
    return [row.handle for row in session.exec(statement).all()]


def refresh_due_count(session: Session, *, now: datetime | None = None) -> int:
    """How many entries have gone stale — the refresh half of the backlog.

    Kept out of `queue_counts` deliberately. Those four counts drive a progress
    display for one report's candidates, where a refresh is not pending work:
    the row has an answer, the report renders it, and folding refreshes in would
    make a bar that never reaches the end. This is the deployment-level number
    instead, and the sweep reports it beside what it enqueued.
    """
    moment = now or utc_now()
    statement = unscoped_select(
        select(func.count())
        .select_from(DirectoryEntry)
        .where(col(DirectoryEntry.refresh_due_at) <= moment),
        reason=PROBE_SCOPE_REASON,
    )
    return int(session.exec(statement).one())


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


def known_handles(session: Session, handles: set[str]) -> set[str]:
    """Which of `handles` the Directory already holds a row for (ticket 04).

    Any row, whatever its verdict — the harvest sweep wants "is this handle
    already on the map", not "does it have an answer". A pending row is already
    queued and a conclusive one is already answered, so in both cases harvesting
    it again would spend the sweep's batch on work that is not new.

    Deliberately not `probe_map`, which builds a camelCase projection of every
    row it touches. The caller wants a set membership test over a few hundred
    handles per tick and would throw the projection away.
    """
    if not handles:
        return set()
    statement = unscoped_select(
        select(col(DirectoryEntry.handle)).where(
            col(DirectoryEntry.handle).in_(handles)
        ),
        reason=PROBE_SCOPE_REASON,
    )
    return {str(row) for row in session.exec(statement).all()}


def _store_statistics(row: DirectoryEntry, stats: SampleStatistics) -> None:
    """Copy the six sample-derived statistics onto the entry.

    One function rather than the assignment written twice, for the reason
    `_apply_page_metadata` is one: the two writers are a conclusive probe and a
    recheck, and a second copy of this list is how one of them comes to miss a
    column. A recheck passes an empty `SampleStatistics()`, which says what it
    means — the row holds no answer, so it measures nothing — rather than six
    `None`s that a reader has to recognise as a set.

    Assignment by name rather than a loop over `fields()`: mypy checks these six
    against the columns, and `setattr` would hand that up to save four lines.
    """
    row.last_post_at = stats.last_post_at
    row.sample_count = stats.sample_count
    row.posts_per_week = stats.posts_per_week
    row.median_views = stats.median_views
    row.forward_share = stats.forward_share
    row.script = stats.script


def _get_or_create(session: Session, handle: str) -> DirectoryEntry:
    row = session.get(DirectoryEntry, handle)
    if row is None:
        row = DirectoryEntry(handle=handle, created_at=utc_now())
        session.add(row)
    return row


def _apply_page_metadata(row: DirectoryEntry, payload: dict[str, Any]) -> None:
    """Copy what a parsed Telegram page said onto the entry.

    Shared by the two writers that hold a page — `record_probe_result` and
    `record_sync_metadata` — because the fields are the same fields and a second
    copy of this list is how one of them comes to miss a column. The *verdict*
    is not here: each caller decides what its own fetch is evidence of, and
    those two answers are deliberately different.

    `or None` on the counters collapses a missing counter and an empty string
    together, which is right: Telegram omits a counter it has none of, and `""`
    would make "no photos" and "we did not look" the same value.

    **The chat id is only ever written, never cleared**, which is the one place
    this does not simply overwrite what it knows. It is decoded from a message
    widget, so a page with no visible messages yields none — and an
    `unavailable` verdict is synthesized with no page at all
    (`jobs/discover_probe.py`). Overwriting would drop the id exactly when the
    channel went private or was renamed, which is the one case it is for: it is
    the only identity that survives a handle rename. A recheck still clears it,
    because `requeue_probes` discards the whole verdict deliberately.

    The four counters *are* overwritten, and that asymmetry is the point. A
    counter is a snapshot of a page and a stale one is a lie; the chat id is
    immutable, so a remembered one stays true however the page changed.
    """
    kind = str(payload.get("kind") or "unknown")
    row.kind = kind if kind in PROBE_KINDS else "unknown"
    row.display_name = payload.get("displayName") or None
    row.bio = payload.get("bio") or None
    row.subscribers = payload.get("subscribers") or None
    row.photos = payload.get("photos") or None
    row.videos = payload.get("videos") or None
    row.files = payload.get("files") or None
    row.links = payload.get("links") or None
    chat_id = payload.get("telegramChatId")
    if isinstance(chat_id, int):
        row.telegram_chat_id = chat_id
    row.photo_url = payload.get("photoUrl") or None
    row.latest_id = int(payload.get("latestId") or 0)


def _schedule_refresh(
    session: Session,
    row: DirectoryEntry,
    *,
    now: datetime,
    provisional: bool = False,
) -> None:
    """Set when this answer goes stale, and where it will sit in the queue.

    Called only where a conclusive verdict has just been written. A dead one
    gets `None` — never due — and a live one gets the window; both take
    `REFRESH_PRIORITY`, because the rank a row is carrying belongs to whatever
    report or recheck first queued it and says nothing about how urgent a
    *refresh* is. Leaving it alone is what would put a rechecked handle at the
    front of the queue every week for ever.

    `provisional` is the first `unavailable` on a handle that was live, which
    stays due so the verdict can be confirmed rather than sealing a Channel on
    one synthesized answer. See `record_probe_result`.
    """
    row.priority = REFRESH_PRIORITY
    window = resolve_refresh_window(session)
    if window is None or not (provisional or is_refreshable(row.status, row.kind)):
        row.refresh_due_at = None
        return
    row.refresh_due_at = now + window


def record_sync_metadata(
    session: Session,
    handle: str,
    meta: dict[str, Any],
    *,
    now: datetime | None = None,
) -> None:
    """Update a followed Channel's entry from the page sync already fetched.

    **No request is made here** (ticket 03, user story 26). Sync walks
    `t.me/s/<handle>` on every run and `_parse_channel_meta` has already reduced
    that page to exactly the fields the Directory wants, so the map stays
    current on the Channels somebody actually reads for nothing — which is the
    half of the Directory most likely to be browsed and the half a crawler paced
    by a weekly window would keep stalest.

    Pass the page's `channelMeta` dict. Three rules, each of them a way this
    could go wrong:

    * **It never writes an `unavailable` verdict.** `isUnavailableOnWebView` is
      `latestId == 0 and a page action`, and a pagination window walked past a
      Channel's first post satisfies both on a perfectly healthy handle. Sync
      reaching this function *is* the evidence the page was readable, so the one
      verdict this path may write is `ok`; a Channel that has genuinely gone
      private fails the fetch and never arrives here.
    * **It never touches the samples**, and structurally rather than by
      convention — nothing in this function can reach `replace_samples`. Sync
      does not parse the preview page's Posts, so it has nothing to say about
      them, and an empty list here would blank every followed Channel's snapshot
      on every sync. This is the moment ticket 02's absent-key rule becomes
      load-bearing.
    * **It does not commit.** `_apply_scrape_page` writes telemetry, gaps, the
      page's Posts and this in one transaction; committing here would land a
      Directory update from a page whose Posts then failed to persist, and would
      commit the caller's half-written page along with it.
    """
    if not meta.get("isTelegramPage"):
        return
    key = normalize_handle(handle)
    if not key:
        return
    moment = now or utc_now()
    row = _get_or_create(session, key)
    row.status = "ok"
    _apply_page_metadata(row, meta)
    row.attempted_at = moment
    row.checked_at = moment
    row.attempts = 0
    row.last_error = None
    row.retry_after = None
    # **An outstanding refresh survives a sync.** `refresh_entries` marks a row
    # due now at the front of the queue, and the probe lane drains strictly
    # after every sync lane — so a sync of that same followed Channel usually
    # lands first, and rescheduling here would push the request a week out at
    # the back of the queue and lose it. Metadata is not the whole of what a
    # refresh fetches: this path never writes samples, so the request has work
    # left to do that a sync cannot perform.
    #
    # The priority is what tells the two apart, and it has to be — "already
    # due" is also what an entry looks like when the window simply elapsed, and
    # declining to reschedule *those* would leave a followed Channel queued for
    # a probe the sync it just had made unnecessary. Only `RECHECK_PRIORITY`
    # means somebody asked.
    if row.priority != RECHECK_PRIORITY:
        _schedule_refresh(session, row, now=moment)
    session.add(row)


def refresh_entries(
    session: Session, handles: list[str], *, priority: int = RECHECK_PRIORITY
) -> list[str]:
    """Mark these entries due now, keeping the answer they already hold.

    The on-demand half of ticket 03, and deliberately not `requeue_probes`. A
    **recheck** says the verdict is *wrong* and discards it, which is right for
    a handle misjudged during an outage. A **refresh** says it is *old*: the
    Operator has the entry open and wants a current answer, so blanking the
    metadata, the chat id and the samples they are reading — for however long
    the queue takes to reach the handle — would take away the thing they opened.

    Jumps the queue at `RECHECK_PRIORITY` for the same reason a recheck does:
    somebody is looking at that row now.

    A dead verdict is refreshed too when it is asked for explicitly. Never
    *automatically* due is not never due — a channel that went private and came
    back is exactly the row an Operator presses this on.

    Returns every handle now due, including ones nobody has probed: asking for a
    handle with no answer yet is reasonable, and it is already pending — such a
    row is moved to the front and left alone otherwise, because a row with no
    answer cannot have a stale one and stamping it would make it count against
    `refresh_due_count`, which is meant to say how much of the *map* has aged.
    """
    now = utc_now()
    refreshed: list[str] = []
    for raw in handles:
        handle = normalize_handle(raw)
        if not handle or handle in refreshed:
            continue
        row = _get_or_create(session, handle)
        if row.status in CONCLUSIVE_STATUSES:
            row.refresh_due_at = now
        # **And the backoff goes**, exactly as `requeue_probes` drops it. A
        # pending handle carrying a backoff from its last failure — up to
        # `RETRY_BACKOFF_MAX_MINUTES`, a full day — fails the pending leg of the
        # dequeue on `retry_after` and the stale leg on a `refresh_due_at` a row
        # with no answer never gets. The route would have answered `refreshed`
        # and nothing would have happened for a day. Somebody is looking at that
        # row; the backoff is a throttle on unattended retries, not on them.
        row.retry_after = None
        row.priority = priority
        session.add(row)
        refreshed.append(handle)
    session.commit()
    return refreshed


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

    **A failed fetch of a handle we already have an answer for keeps that
    answer** (ticket 03). Before refreshing existed this branch could only be
    reached by a handle with no verdict, so demoting the row to `unknown` cost
    nothing. Now every live entry is re-fetched on a window, and one timeout
    behind one proxy would blank a perfectly good Directory entry in every
    report that joins it — the same "a wrong answer is permanent" failure the
    verdict rule exists to prevent, arriving from the other direction. The
    failure is still recorded; only the verdict survives it.
    """
    key = normalize_handle(handle)
    row = _get_or_create(session, key)
    now = utc_now()
    row.attempted_at = now

    inconclusive = info is None or not info.get("isTelegramPage")
    if inconclusive:
        held_a_verdict = row.status in CONCLUSIVE_STATUSES
        if not held_a_verdict:
            row.status = "unknown"
        row.attempts += 1
        row.last_error = error or "no telegram page in response"
        # Stays queued, but not due again until the backoff elapses.
        row.retry_after = _retry_deadline(row.attempts, now=now)
        if held_a_verdict:
            # The row keeps its verdict, so the *pending* leg of the dequeue
            # will never hand it back — the refresh leg is the only way it
            # returns, and it has to carry the backoff or a handle failing
            # behind a dead proxy would be re-fetched on every single tick.
            #
            # This is the two clocks agreeing about one row, not merging into
            # one: `retry_after` still answers "how long since this fetch
            # failed" and is what computes the ladder, while `refresh_due_at`
            # still answers "when is this handle wanted again". They are equal
            # here because a failed refresh wants exactly the backoff, and they
            # part company again the moment the fetch succeeds.
            row.refresh_due_at = row.retry_after
        session.commit()
        session.refresh(row)
        return probe_to_camel(row)

    payload: dict[str, Any] = info or {}
    # **An `unavailable` that overturns an `ok` is provisional** (ticket 03).
    #
    # That verdict is synthesized in `jobs/discover_probe.py` with no page
    # behind it: `fetch_with_retry` raises `TelegramWebViewUnavailable` for any
    # response carrying a `tgme_page_action` and no message widgets, which is
    # what a private or deleted handle looks like *and* what a sensitive-content
    # interstitial or some regional variants look like. Sealing on the first one
    # would blank a live Channel's entry and set `refresh_due_at` to `None`,
    # which is dead — nothing would ever look at that handle again, and the
    # Operator would have to know to press refresh on a row that no longer
    # displays anything to suggest it was ever alive.
    #
    # Unreachable before this ticket, because an `ok` entry was never re-fetched
    # without somebody asking. Refreshing makes it a weekly lottery over every
    # live entry in the Directory, so the downgrade takes **two consecutive**
    # answers: the first keeps the metadata and stays due, the second seals it
    # exactly as before. A handle that was dead the first time we ever looked is
    # sealed immediately — it never held `ok` — so "a dead verdict never becomes
    # due again" still holds for every handle the rule was written about. The
    # cost of the confirmation is one extra fetch, once, per Channel that
    # genuinely goes dark.
    was_live = row.status == "ok"
    row.status = "unavailable" if payload.get("isUnavailableOnWebView") else "ok"
    provisional_downgrade = was_live and row.status == "unavailable"
    if not provisional_downgrade:
        _apply_page_metadata(row, payload)
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
        # **An `unavailable` verdict keeps the statistics** (ticket 02,
        # ADR-015). This is the one place the statistics and the samples part
        # company, and it follows from why they are stored at all: an
        # unavailable entry stops being refreshed, so it can never recompute
        # them, and it is precisely the row where "posted four times a week
        # until fourteen months ago" is worth more than the bare verdict. The
        # samples above are cleared on that verdict — a page with no readable
        # messages has no recent Posts — and the statistics are the record they
        # leave behind.
        #
        # The row loses its subscriber count, its four counters and its latest
        # Post id on the same path, and with them the media mix and density,
        # because those are snapshots of a page and a stale snapshot is a lie.
        # A sample-derived statistic is a claim about what the Channel *did*,
        # which stays true after it goes away.
        #
        # Read back rather than computed from `samples`: the transform takes
        # Posts, and the rows `replace_samples` just flushed are the Posts. That
        # is what lets the Channels tab point the same function at the corpus
        # later instead of reimplementing these formulas over a second shape.
        if row.status == "ok":
            _store_statistics(row, compute_sample_statistics(samples_for(session, key)))
    # A conclusive answer clears the failure history: the backoff exists to
    # throttle retries of an unresolved handle, and this one is now resolved.
    row.attempts = 0
    row.last_error = None
    row.retry_after = None
    row.checked_at = now
    _schedule_refresh(session, row, now=now, provisional=provisional_downgrade)
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
        # The statistics go with the verdict, and this is the one path where
        # they do (ticket 02). A recheck resets the row to `unknown`, which
        # means the deployment holds *no* answer rather than a negative one, so
        # a row still showing "4.2 posts/week" beside "not checked" would be
        # claiming a measurement it has disowned. An `unavailable` verdict is
        # the opposite case and keeps them — see `record_probe_result`.
        _store_statistics(row, SampleStatistics())
        row.attempts = 0
        row.last_error = None
        row.checked_at = None
        row.attempted_at = None
        row.retry_after = None
        # The due time goes with the verdict it belonged to (ticket 03). A row
        # with no answer is *pending*, not stale, and leaving a due time on it
        # would have the refresh leg of the dequeue hand back a handle the
        # pending leg is already answering for.
        row.refresh_due_at = None
        row.priority = priority
        session.add(row)
        requeued.append(handle)
    session.commit()
    return requeued
