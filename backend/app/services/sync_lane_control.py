"""Pause, drain and inspect one sync lane (ticket 12, checkbox 4).

An **orchestrator** in the sense `tests/services/test_service_kinds.py` means:
it owns one workflow — an Admin operating a lane — and coordinates the modules
that own the pieces. `settings_store` holds the paused set because it is the
only writer of `tg_app_settings`; `pgmq` moves the messages because it owns that
boundary; `scraper_jobs` resolves what a purge does to the jobs behind the
messages. None of that belongs here, and this is the only place they meet.

**Pause and drain are different acts, not two strengths of one.** Pausing stops
the worker taking new messages from a lane and leaves them queued, so it is
reversible and loses nothing: it is what an operator reaches for when a lane is
misbehaving and they want to think. Draining empties the lane now and the work
is gone.

**Drain means purge, not "run this lane next."** The second reading is already
what the enqueue ring plus the 30-second sweep do, so building it would be a
second spelling of an existing mechanism. This one adds something an operator
cannot otherwise get: a lane with a runaway backlog, emptied.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlmodel import Session

from app.core.db import engine
from app.services import pgmq
from app.services.settings_registry import SYNC_LANES_KEY
from app.services.settings_store import get_global_setting, put_global_setting
from app.services.sync_lanes import DRAIN_ORDER

logger = logging.getLogger(__name__)

#: Field inside the `sync_lanes` settings row. A list rather than a flag per
#: lane, so a lane added by a later ticket needs no migration to be pausable.
PAUSED_FIELD = "pausedLanes"


@dataclass(frozen=True)
class LaneDepth:
    """What is sitting on one lane, for the Admin view."""

    lane: str
    queued: int
    paused: bool


@dataclass(frozen=True)
class DrainResult:
    """What a purge actually did."""

    lane: str
    archived: int
    jobs_cancelled: int


def require_lane(lane: str) -> str:
    """Reject a lane name that is not one of the six.

    The name reaches SQL as an identifier (`pgmq."q_<lane>"`), so this is the
    boundary that keeps a path parameter out of a query. Membership of
    `DRAIN_ORDER` — a tuple built in code from the Budget/tier product — is the
    check, rather than a pattern that would also admit a well-formed name for a
    queue that does not exist.
    """
    if lane not in DRAIN_ORDER:
        raise ValueError(f"unknown lane {lane!r}")
    return lane


def paused_lanes(session: Session) -> set[str]:
    """The lanes an Admin has paused.

    Filtered against `DRAIN_ORDER` on the way out: a stored name that is no
    longer a lane is stale settings data, and letting it through would have the
    worker comparing against a lane it never drains — invisible, and exactly
    the kind of thing that is discovered a year later.
    """
    stored = get_global_setting(session, SYNC_LANES_KEY).get(PAUSED_FIELD) or []
    if not isinstance(stored, list):
        return set()
    return {lane for lane in stored if lane in DRAIN_ORDER}


def set_lane_paused(session: Session, lane: str, *, paused: bool) -> set[str]:
    """Pause or resume one lane. Returns the full paused set afterwards.

    Writes the whole list back, which is safe here for the reason the ticket 06
    carve made unsafe elsewhere: this row has exactly one field and one writer,
    so there is no second author whose value a read-modify-write could clobber.
    """
    require_lane(lane)
    current = paused_lanes(session)
    updated = current | {lane} if paused else current - {lane}
    put_global_setting(session, SYNC_LANES_KEY, {PAUSED_FIELD: sorted(updated)})
    return updated


def lane_depths(session: Session) -> list[LaneDepth]:
    """Every lane, its queue length, and whether it is paused.

    Queue length counts messages in flight as well as due ones — `queue_length`
    reads the table — because an operator asking "what is on this lane" is
    asking what is not finished, not what is unclaimed.
    """
    paused = paused_lanes(session)
    return [
        LaneDepth(
            lane=lane,
            queued=pgmq.queue_length(session, lane),
            paused=lane in paused,
        )
        for lane in DRAIN_ORDER
    ]


async def drain_lane(lane: str) -> DrainResult:
    """Empty one lane: archive every message on it, cancel the jobs behind them.

    **Cancelling the jobs is not tidiness, it is the whole difference between
    this and a data-loss bug.** Since ticket 10 there is no `run_sync_job` above
    the Channels; a job goes terminal when its last Channel does
    (`sync_queue._finalize_if_complete`). Archiving 40 messages of a 50-message
    batch therefore leaves 40 Channels `pending` for ever, the job non-terminal
    for ever, and `has_active_sync_job()` answering True — which makes auto-sync
    skip every tick from then on. The partial purge is the case that matters,
    and it is the likely one: a lane holds several jobs' messages at once.

    `cancel_job` is the right primitive rather than a new terminal state,
    because it already marks every pending or running Channel cancelled, writes
    the terminal row, and travels to the process actually running the sync over
    the progress channel. That last part matters here: this runs in the API
    process and the Channels still in flight are the worker's.

    Archived rather than deleted, following decision 32's "archive on success
    too" — the archive is the record of what the lane held, and an operator who
    has just discarded a backlog is precisely who might need to see it.

    Messages *in flight* are archived too (`queued_messages` ignores the
    visibility timeout). A purge that skipped them would leave a crashed
    worker's messages to be redelivered onto a lane the operator has emptied.
    """
    require_lane(lane)
    with Session(engine) as session:
        messages = pgmq.queued_messages(session, lane)
        msg_ids = [msg.msg_id for msg in messages]
        job_ids = {
            job_id
            for msg in messages
            if isinstance(job_id := msg.message.get("jobId"), str)
        }
        archived = pgmq.archive_batch(session, lane, msg_ids)
        session.commit()

    # After the commit, and in a session of its own: `cancel_job` persists and
    # notifies, and holding the purge's transaction open across it is the
    # await-with-a-session-open shape that left `tg_sync_meta` with 4,743 dead
    # rows. Nothing here needs the two to be atomic — a cancel that failed
    # would leave a job whose messages are gone, which is what the next
    # `reconcile_interrupted_jobs` is for.
    from app.services.scraper_jobs import cancel_job

    cancelled = 0
    for job_id in sorted(job_ids):
        try:
            if await cancel_job(job_id) is not None:
                cancelled += 1
        except Exception:  # noqa: BLE001
            logger.exception("could not cancel job %s while draining %s", job_id, lane)

    logger.info(
        "drained lane %s: archived %s message(s), cancelled %s job(s)",
        lane,
        len(archived),
        cancelled,
    )
    return DrainResult(lane=lane, archived=len(archived), jobs_cancelled=cancelled)
