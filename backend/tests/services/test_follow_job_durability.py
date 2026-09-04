"""A bulk follow survives the process that started it, and the API never runs it.

`run_follow_job` was started by `asyncio.create_task` from an API route, with
`FollowJobState` living in a module-global dict. That put the probe phase — one
`t.me` fetch per handle, hundreds in a batch — in the web tier, on an
`asyncio.Semaphore(4)` of its own: a scraping budget the Partition does not
know about, and fetches bound to no proxy, so each picked whichever lane was
least loaded. It could not be fixed in place, because the API process builds no
Partition on purpose (ADR-012 D5): per-proxy limits are per-process, and a
second Partition would double the rate every proxy sees.

So the runner moved to the worker, and everything the API used to read out of
memory now comes from `tg_follow_jobs`. These are the properties that makes
worth having: the row outlives the process, a cancel crosses the process
boundary, and a job interrupted by a restart does not stay `running` for ever.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import pathlib
import uuid
from unittest.mock import AsyncMock, patch

from sqlmodel import Session

from app.api.routes.data import channels as channels_route
from app.core.db import engine
from app.models_tg import FollowJob
from app.services import bulk_follow
from app.services.follow_jobs import (
    FOLLOW_JOB_EVENTS_CHANNEL,
    FOLLOW_JOB_TRIGGER_CHANNEL,
    reconcile_interrupted,
)


def _seed(status: str = "running", *, user_id: uuid.UUID) -> str:
    """One follow job row with two handles, one done and one in flight.

    The handles are unique per job. They were `alpha`/`beta`, and the
    end-to-end test below actually *runs* the job — so a fixed pair created two
    real channels that `test_bulk_follow.py` then counted as already-followed,
    turning its `added` assertions into `skipped` ones. Shared corpus rows are
    the pollution `tests/utils/tg_cleanup.py` exists for; unique names are the
    cheaper half of the same discipline.
    """
    follow_job_id = f"fj-{uuid.uuid4().hex[:8]}"
    with Session(engine) as session:
        session.add(
            FollowJob(
                id=follow_job_id,
                user_id=user_id,
                source="test",
                status=status,
                results=[
                    {"name": f"{follow_job_id}-done", "status": "added"},
                    {"name": f"{follow_job_id}-live", "status": "running"},
                ],
                options={},
                created_at=1,
            )
        )
        session.commit()
    return follow_job_id


def test_a_job_is_readable_from_a_process_that_never_saw_it(db: Session) -> None:
    """The whole reason for the table. `_active_jobs` is empty in every API
    replica, so without the row the three bulk-follow routes would answer 404
    for every job that exists."""
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    follow_job_id = _seed(user_id=user.id)
    bulk_follow.clear_follow_jobs_for_tests()

    state = bulk_follow.get_follow_job(follow_job_id)

    assert state is not None
    assert state.status == "running"
    assert [r.name for r in state.results] == [
        f"{follow_job_id}-done",
        f"{follow_job_id}-live",
    ]
    assert state.user_id == str(user.id)


def test_a_cancel_crosses_the_process_boundary(db: Session) -> None:
    """An `asyncio.Event` reaches nobody: the cancel lands in the API and the
    runner is in the worker. The column is what carries it, and a ring alone
    would not — `NOTIFY` has no replay, so a cancel arriving while the worker
    restarts would be lost and the batch would finish after being cancelled."""
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    follow_job_id = _seed(user_id=user.id)
    bulk_follow.clear_follow_jobs_for_tests()

    asyncio.run(bulk_follow.cancel_follow_job(follow_job_id))

    with Session(engine) as session:
        row = session.get(FollowJob, follow_job_id)
        assert row is not None
        assert row.cancel_requested is True
        assert row.status == "cancelled"
        # The handle already added stays added. "Cancel" has always meant "stop
        # adding", not "undo".
        assert [r["status"] for r in row.results] == ["added", "cancelled"]


def test_a_restart_does_not_leave_a_follow_running_for_ever(db: Session) -> None:
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    running = _seed("running", user_id=user.id)
    done = _seed("completed", user_id=user.id)

    with Session(engine) as session:
        failed = reconcile_interrupted(session)

    assert failed == 1
    with Session(engine) as session:
        assert session.get(FollowJob, running).status == "failed"  # type: ignore[union-attr]
        assert session.get(FollowJob, done).status == "completed"  # type: ignore[union-attr]


def test_the_route_hands_off_rather_than_running_the_job() -> None:
    """From the AST. A `create_task(run_follow_job(...))` put back beside the
    trigger would leave every behaviour test green — the job would still run,
    just in the wrong tier — which is exactly the failure this ticket is about."""
    tree = ast.parse(pathlib.Path(inspect.getfile(channels_route)).read_text())
    start = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "start_bulk_follow"
    )
    called = {
        node.func.id
        for node in ast.walk(start)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    } | {
        node.func.attr
        for node in ast.walk(start)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }

    assert "request_follow_job_run" in called
    assert "run_follow_job" not in called, (
        "the API route runs the follow job itself again, so its probe phase is "
        "back in the web tier — outside the Partition, bound to no proxy"
    )
    assert "create_task" not in called, (
        "the route starts a task of its own; an API restart mid-batch takes "
        "the follow with it, which is what the row and the trigger removed"
    )


def test_the_probe_phase_takes_slots_rather_than_a_semaphore() -> None:
    """`FOLLOW_SCRAPE_CONCURRENCY` was four concurrent probes that nothing
    counted. It is the Partition's width now, which is the same number that
    bounds every other kind of scraping in the process."""
    tree = ast.parse(pathlib.Path(inspect.getfile(bulk_follow)).read_text())
    runner = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "run_follow_job"
    )
    names = {
        node.func.attr
        for node in ast.walk(runner)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    } | {
        node.func.id
        for node in ast.walk(runner)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }

    assert "Semaphore" not in names, (
        "the follow job gates its own concurrency again; that is a scraping "
        "budget the Partition does not know about"
    )
    assert "get_partition" in names and "SyncSlot" in names
    assert not hasattr(bulk_follow, "FOLLOW_SCRAPE_CONCURRENCY")


def test_the_worker_starts_the_consumer_and_the_api_does_not() -> None:
    """The two gates that decide where a follow job runs, asserted together —
    they are the same shape as the two auth gates `CLAUDE.md` records drifting
    apart for months."""
    from app import main as api_main
    from app import worker

    worker_source = pathlib.Path(inspect.getfile(worker)).read_text()
    assert "start_follow_job_consumer()" in worker_source
    assert "reconcile_interrupted_follow_jobs()" in worker_source

    api_source = pathlib.Path(inspect.getfile(api_main)).read_text()
    assert "start_follow_job_consumer" not in api_source, (
        "the API starts the follow-job consumer, so both tiers would run the "
        "same job and each would own every proxy"
    )


def test_the_two_notify_channels_are_distinct() -> None:
    """A trigger delivered onto the progress channel would make every SSE
    stream in every replica start the job it is watching."""
    assert FOLLOW_JOB_TRIGGER_CHANNEL != FOLLOW_JOB_EVENTS_CHANNEL


def test_the_worker_runs_a_triggered_follow_job(db: Session) -> None:
    """The real path, once: notify in, consumer out, row terminal.

    Every other test here drives `run_follow_job_by_id` directly and
    `tests/api/test_bulk_follow.py` stands in for the worker with a fixture, so
    without this the trigger channel would be asserted by nothing at all — a
    seam that exists in three files and is exercised in none.
    """
    from app.core import pg_notify
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    follow_job_id = _seed("pending", user_id=user.id)
    bulk_follow.clear_follow_jobs_for_tests()

    async def _run() -> str:
        pg_notify.reset_listeners_for_tests()
        bulk_follow.start_follow_job_consumer()
        listening = await pg_notify.listener(
            FOLLOW_JOB_TRIGGER_CHANNEL
        ).wait_until_listening()
        assert listening, "the consumer never issued its LISTEN"

        # The fetch is patched to fail, so this creates no channels: the
        # point is that the trigger reaches the runner, and a failed handle is
        # still a terminal job. Letting it fetch for real made two rows in the
        # shared corpus that a later module counted as already-followed.
        with patch(
            "app.services.bulk_follow.get_channel_info",
            new_callable=AsyncMock,
            side_effect=RuntimeError("no network in tests"),
        ):
            await bulk_follow.request_follow_job_run(follow_job_id)

            deadline = asyncio.get_running_loop().time() + 20
            while asyncio.get_running_loop().time() < deadline:
                state = bulk_follow.get_follow_job(follow_job_id)
                if state is not None and state.status in ("completed", "failed"):
                    return state.status
                await asyncio.sleep(0.05)
        raise AssertionError("the worker never ran the triggered follow job")

    try:
        assert asyncio.run(_run()) in ("completed", "failed")
    finally:
        bulk_follow.stop_follow_job_consumer()
        pg_notify.reset_listeners_for_tests()


def test_a_finished_job_is_dropped_from_memory_and_still_readable(
    db: Session,
) -> None:
    """The worker is long-lived, so `_active_jobs` must not grow per follow.

    One entry per bulk follow held for the life of the process is the
    unbounded-cache shape `scraper_jobs._get_cancel_event` documents. Dropping
    it is only safe because the row answers afterwards — which is the half that
    would silently turn into a 404 if the terminal flush ever stopped being
    immediate, so both are asserted together.
    """
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    follow_job_id = _seed("running", user_id=user.id)
    bulk_follow.clear_follow_jobs_for_tests()

    state = bulk_follow.get_follow_job(follow_job_id)
    assert state is not None
    state.status = "completed"
    asyncio.run(bulk_follow.touch_follow_job(state))

    assert bulk_follow.get_follow_job(follow_job_id) is not None, (
        "a finished job became unreadable; the row is what answers once memory "
        "lets go of it"
    )
    assert follow_job_id not in bulk_follow._active_jobs, (
        "a finished job stays in memory for the life of the worker"
    )


# --- what the review found ------------------------------------------------


def test_the_api_does_not_cache_a_job_it_will_never_update(db: Session) -> None:
    """`create_follow_job` runs in the API and the runner is in the worker.

    An entry in `_active_jobs` here is never updated by anything, and
    `get_follow_job` prefers memory over the row — so `GET .../{id}` answered
    `pending` for ever and `/events` never emitted `[DONE]`. The tests missed
    it because each one calls `clear_follow_jobs_for_tests()`, which empties
    the very dict that was wrong. Found in review.
    """
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    bulk_follow.clear_follow_jobs_for_tests()

    job = asyncio.run(
        bulk_follow.create_follow_job(
            channels=[{"name": "cache_check"}], user_id=str(user.id)
        )
    )

    assert job.follow_job_id not in bulk_follow._active_jobs, (
        "the creating process cached the job; only the process that mutates "
        "one may, or every read in this replica answers with the initial state"
    )
    # And it is still readable, from the row.
    assert bulk_follow.get_follow_job(job.follow_job_id) is not None


def test_a_worker_flush_does_not_resurrect_a_cancelled_job(db: Session) -> None:
    """The cancel is written by the API while the worker is still fanning out.

    Its next throttled flush wrote `status="running"` and `finished_at=None`
    back over the cancel — the row only converged when the batch finished, and
    stayed `running` for ever if the worker died first, which is exactly what
    `request_cancel` sets the terminal state to avoid. Found in review.
    """
    from app.services.follow_jobs import request_cancel, write_progress
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    follow_job_id = _seed("running", user_id=user.id)
    names = [f"{follow_job_id}-done", f"{follow_job_id}-live"]

    with Session(engine) as session:
        request_cancel(session, follow_job_id)

    # The worker's in-flight flush, arriving after the cancel.
    with Session(engine) as session:
        write_progress(
            session,
            follow_job_id=follow_job_id,
            status="running",
            results=[
                {"name": names[0], "status": "added"},
                {"name": names[1], "status": "running"},
            ],
            sync_job_id=None,
            finished_at=None,
        )

    with Session(engine) as session:
        row = session.get(FollowJob, follow_job_id)
        assert row is not None
        assert row.status == "cancelled", "a flush in flight un-cancelled the job"
        assert row.finished_at is not None
        by_name = {e["name"]: e["status"] for e in row.results}
        # The handle the worker finished before the cancel keeps its outcome:
        # it really was added, and saying otherwise would misreport the corpus.
        assert by_name[names[0]] == "added"
        # The one still running when the cancel landed stays cancelled.
        assert by_name[names[1]] == "cancelled"


def test_a_finished_follow_job_is_eventually_pruned(db: Session) -> None:
    """It shipped with no retention at all, unlike the `tg_sync_jobs` it is
    modelled on — and its rows are the larger ones, carrying the whole results
    array. Found in review."""
    from app.services.follow_jobs import prune_finished
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    old_done = _seed("completed", user_id=user.id)
    still_running = _seed("running", user_id=user.id)

    with Session(engine) as session:
        for job_id in (old_done, still_running):
            row = session.get(FollowJob, job_id)
            assert row is not None
            row.created_at = 0  # 1970, comfortably past any window
            session.add(row)
        session.commit()
        deleted = prune_finished(session, max_age_days=14)

    assert deleted == 1
    with Session(engine) as session:
        assert session.get(FollowJob, old_done) is None
        assert session.get(FollowJob, still_running) is not None, (
            "a follow still running was deleted out from under the browser "
            "watching its stream"
        )


def test_a_disabled_window_prunes_nothing(db: Session) -> None:
    from app.services.follow_jobs import prune_finished
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    done = _seed("completed", user_id=user.id)

    with Session(engine) as session:
        assert prune_finished(session, max_age_days=0) == 0
        assert session.get(FollowJob, done) is not None
