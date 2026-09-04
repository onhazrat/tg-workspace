"""The `tg_follow_jobs` aggregate: a bulk follow that outlives its process.

**Sole writer of `tg_follow_jobs`.** A Discover bulk follow was a dataclass in
`bulk_follow._active_jobs`, created and run by `asyncio.create_task` from the
API route. Ticket 36 moves the runner to the worker (ADR-012 D7), because the
probe phase is a `t.me` fetch per handle and running it in the web tier put it
outside the scraping Partition — four concurrent fetches on a semaphore of
their own, bound to no proxy.

The moment the runner leaves the API process, the API's own status route and
SSE stream read an empty dict and cancel sets an event nobody sees. So the job
needs a row: this module owns it, `bulk_follow` runs against it, and the three
routes read it. Exactly the shape tickets 10 and 11 built for `SyncJob`.

**Cancellation is a column, not only a ring.** `pg_notify` has no replay, so a
cancel that arrives while the worker is restarting would be lost and the job
would run to completion after being cancelled. The column is the truth; the
notification is what makes it prompt.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, col, select

from app.models_tg import FollowJob, utc_now

#: Progress. Published by the worker on every flush, read by the API's SSE
#: stream, which re-reads the row rather than trusting the payload — the
#: notification says *something changed*, and the row says what.
FOLLOW_JOB_EVENTS_CHANNEL = "follow_job_events"

#: "Please run this follow job." Published by the API when it creates one, and
#: by the same route's cancel. Mirrors `SCHEDULER_TRIGGER_CHANNEL`: the API
#: asks, the worker does, and the API never scrapes.
FOLLOW_JOB_TRIGGER_CHANNEL = "follow_job_trigger"

TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled"})


def create_row(
    session: Session,
    *,
    follow_job_id: str,
    user_id: uuid.UUID,
    source: str,
    results: list[dict[str, Any]],
    options: dict[str, Any],
    created_at: int,
) -> None:
    session.add(
        FollowJob(
            id=follow_job_id,
            user_id=user_id,
            source=source,
            status="pending",
            results=results,
            options=options,
            created_at=created_at,
        )
    )
    session.commit()


def read_row(session: Session, follow_job_id: str) -> FollowJob | None:
    return session.get(FollowJob, follow_job_id)


def write_progress(
    session: Session,
    *,
    follow_job_id: str,
    status: str,
    results: list[dict[str, Any]],
    sync_job_id: str | None,
    finished_at: int | None,
) -> None:
    """Flush the runner's working copy back to the row.

    Rewrites the whole `results` array to record one handle, which is why the
    caller throttles it — the same measurement `scraper_jobs._should_flush_db`
    was written for. `cancel_requested` is deliberately not written here: it is
    the API's to set and the runner's to read, and a runner that wrote it back
    would race a cancel arriving mid-flush.
    """
    row = session.get(FollowJob, follow_job_id)
    if row is None:
        return
    if row.cancel_requested and row.status in TERMINAL_STATUSES:
        # **A cancelled job is not resurrected by a flush in flight.** The
        # cancel is written by the API while the worker is still fanning out,
        # so the worker's next throttled flush carried `status="running"` and
        # `finished_at=None` straight back over it — the row only converged
        # when the batch finished, and stayed `running` for ever if the worker
        # died first, which is the exact failure `request_cancel` sets the
        # terminal state to avoid. Caught in review.
        #
        # The results still land, because they are what the batch actually did
        # before it stopped: a handle added between the cancel and the last
        # flush is added, and saying otherwise would be a lie about the corpus.
        row.results = _keep_cancelled(row.results, results)
        row.updated_at = utc_now()
        session.add(row)
        session.commit()
        return
    row.status = status
    row.results = results
    row.sync_job_id = sync_job_id
    row.finished_at = finished_at
    row.updated_at = utc_now()
    session.add(row)
    session.commit()


def _keep_cancelled(
    cancelled: list[dict[str, Any]], incoming: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Merge a worker flush into a cancelled row without un-cancelling it.

    An entry the cancel marked `cancelled` stays cancelled — it is a terminal
    state, and the worker's copy of it is by definition older than the cancel.
    Anything the worker resolved (`added`, `unavailable`, `skipped`, `error`)
    wins, because that is a fact about what happened.
    """
    by_name = {str(entry.get("name")): entry for entry in incoming}
    merged: list[dict[str, Any]] = []
    for entry in cancelled:
        fresh = by_name.get(str(entry.get("name")))
        if (
            entry.get("status") == "cancelled"
            and fresh is not None
            and fresh.get("status") in ("pending", "running", "cancelled")
        ):
            merged.append(entry)
        else:
            merged.append(fresh if fresh is not None else entry)
    return merged


def request_cancel(session: Session, follow_job_id: str) -> FollowJob | None:
    """Mark the job cancelled and ask the worker to stop.

    Sets the terminal state here rather than waiting for the worker to notice,
    because the browser is on the other end of the cancel and a job that stays
    `running` after a successful cancel reads as a failed cancel. The worker
    checks `cancel_requested` between handles and stops adding channels; the
    ones already added stay added, which is what "cancel" has always meant here.
    """
    row = session.get(FollowJob, follow_job_id)
    if row is None:
        return None
    row.cancel_requested = True
    if row.status in ("pending", "running"):
        row.status = "cancelled"
        row.finished_at = int(utc_now().timestamp() * 1000)
        row.results = [
            {**entry, "status": "cancelled"}
            if entry.get("status") in ("pending", "running")
            else entry
            for entry in row.results
        ]
    row.updated_at = utc_now()
    session.add(row)
    session.commit()
    return row


def is_cancelled(session: Session, follow_job_id: str) -> bool:
    row = session.get(FollowJob, follow_job_id)
    return bool(row and row.cancel_requested)


def prune_finished(session: Session, *, max_age_days: int) -> int:
    """Delete terminal follow-job rows older than `max_age_days`. Returns how many.

    `scraper_jobs.prune_finished_jobs`' rule, and this table needs it for the
    same reason plus one of its own: each row carries the whole `results` array,
    up to a few hundred entries, so a deployment that bulk-follows regularly
    accumulates the largest rows in the table it never reads again.

    **Terminal only**, so a long follow is never deleted out from under the
    browser watching its stream. `0` disables the sweep, matching every other
    retention window here.
    """
    if max_age_days <= 0:
        return 0
    cutoff_ms = int(utc_now().timestamp() * 1000) - max_age_days * 86_400_000
    rows = session.exec(
        select(FollowJob).where(
            col(FollowJob.status).in_(TERMINAL_STATUSES),
            col(FollowJob.created_at) < cutoff_ms,
        )
    ).all()
    for row in rows:
        session.delete(row)
    session.commit()
    return len(rows)


def reconcile_interrupted(session: Session) -> int:
    """Fail every non-terminal row at worker boot. Returns how many.

    `reconcile_interrupted_jobs`' reasoning, and this time without its
    exception: a sync job's messages can be durably queued, so a non-terminal
    sync row may be *waiting* rather than dead. A follow job has no queue — the
    worker runs it directly off the trigger — so a non-terminal row at boot
    belongs to a process that is gone, and leaving it `running` means a
    spinner that never resolves.
    """
    rows = session.exec(
        select(FollowJob).where(col(FollowJob.status).notin_(TERMINAL_STATUSES))
    ).all()
    now_ms = int(utc_now().timestamp() * 1000)
    for row in rows:
        row.status = "failed"
        row.finished_at = now_ms
        row.results = [
            {
                **entry,
                "status": "error",
                "error": "The worker restarted while this follow was running",
            }
            if entry.get("status") in ("pending", "running")
            else entry
            for entry in row.results
        ]
        row.updated_at = utc_now()
        session.add(row)
    session.commit()
    return len(rows)
