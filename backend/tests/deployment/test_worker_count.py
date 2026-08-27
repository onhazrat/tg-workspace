"""The image runs one worker, and this says why — so it can stop saying it.

`backend/Dockerfile` shipped `--workers 4` (the FastAPI template default, never
reconciled with the scheduler added later). Each worker starts its own in-process
APScheduler, so on staging **four `Auto Sync (scheduler)` jobs were created every
tick**, four workers scraped the same channels, and every scheduled job cost four
times what it should. Nothing failed; it just quietly cost 4x and stranded 711
job rows in `running`.

A comment saying "keep this at 1" would rot the moment someone needs capacity —
and they *will*, since the plan is to serve many users. So this asserts the
**reason** rather than the number, following `client-split.conform.ts`:

1. the worker count is 1, **and**
2. the pieces of per-process state that make >1 wrong are still per-process.

Externalise them and (2) fails, which is the point: the failure message is the
notification that the constraint is lifted, not an obstacle to lifting it. The
sequenced plan is `docs/scaling-to-multiple-workers.md`.

Two have now been externalised, and each left a guard pointing the other way
rather than an absence. The scheduler moved to its own process in ticket 10, so
`test_the_scheduler_has_left_the_api_process` asserts the API does *not* start
it. The per-channel lock became a claim on `tg_channels` in ticket 11, so
`test_the_per_channel_claim_is_no_longer_in_process_memory` asserts the lock
has not come back beside it. What remains genuinely per-process is the job
registry and the proxy pool's semaphores — and the second is why the sync tier
is pinned to one replica until ticket 13.
"""

from __future__ import annotations

import ast
import inspect
import pathlib
import re

import pytest

from app.core.config import settings
from app.services import proxy_pool, scraper_jobs

_BACKEND = pathlib.Path(__file__).resolve().parents[2]
_DOCKERFILE = _BACKEND / "Dockerfile"
_MAIN = _BACKEND / "app" / "main.py"
_WORKER = _BACKEND / "app" / "worker.py"
_PLAN = _BACKEND.parent / "docs" / "scaling-to-multiple-workers.md"


def _called_names(path: pathlib.Path) -> set[str]:
    """Functions actually *called* in a module, from its AST.

    Not `"name" in source`, for the reason the `localStorage` guard in the
    frontend strips comments and strings before matching: the docstrings in
    `main.py` explain at length that it no longer starts the scheduler, and a
    substring check reads that explanation as the thing it forbids. A guard
    that a correct file cannot satisfy is worse than no guard — the first
    person to hit it deletes it.
    """
    tree = ast.parse(path.read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                names.add(func.id)
            elif isinstance(func, ast.Attribute):
                names.add(func.attr)
    return names


def _worker_count() -> int:
    cmd = re.search(r"^CMD \[(.+)\]", _DOCKERFILE.read_text(), re.M)
    assert cmd, "no CMD line in the Dockerfile — this guard cannot see the worker count"
    tokens = re.findall(r'"([^"]+)"', cmd.group(1))
    if "--workers" not in tokens:
        return 1
    return int(tokens[tokens.index("--workers") + 1])


def test_the_image_runs_one_worker() -> None:
    assert _worker_count() == 1, (
        f"the image runs {_worker_count()} workers. Every scheduled job will fire "
        f"that many times and the syncs will duplicate. See {_PLAN.name}."
    )


def test_the_scheduler_has_left_the_api_process() -> None:
    """Reason 1, **completed by ticket 10** — so this now asserts the opposite.

    This used to read `assert "start_scheduler" in main.py`, with a message
    saying that if the scheduler ever moved to its own single-replica service,
    the guard and the Dockerfile should be revisited together. That is what
    happened, so the assertion is inverted rather than deleted: the constraint
    it protected (worker count is a tick multiplier) is gone, and what needs
    protecting now is that it does not come back. An API process that started
    APScheduler again would double every scheduled job against the worker's,
    silently, which is the same failure `--workers 4` caused.

    Two of the three reasons for `--workers 1` therefore survive: the job
    registry and the proxy pool. Ticket 13 is what removes the proxy one.
    """
    assert "start_scheduler" not in _called_names(_MAIN), (
        "the API process starts the scheduler again — it belongs to app/worker.py "
        f"alone, or every scheduled job fires twice ({_PLAN.name})"
    )
    assert _WORKER.is_file(), (
        "app/worker.py is gone but nothing in the API starts the scheduler either, "
        "so nothing is scheduling anything"
    )
    assert "start_scheduler" in _called_names(_WORKER), (
        "app/worker.py no longer starts the scheduler"
    )


def test_the_api_no_longer_fails_jobs_the_worker_is_running() -> None:
    """The half of the split that is easy to miss.

    `reconcile_interrupted_jobs` marks every non-terminal `tg_sync_jobs` row
    failed at startup, which was sound only while a restart of the API meant
    the sync was definitely dead. After ticket 10 it is not: an ordinary deploy
    of the web tier would mark every job the worker is currently running as
    failed, and the browser would be told so while the scrape carried on.
    """
    assert "reconcile_interrupted_jobs" not in _called_names(_MAIN), (
        "the API process reconciles interrupted jobs again — after ticket 10 it "
        "cannot tell a dead sync from a live one, and will fail the worker's "
        "in-flight jobs on every deploy"
    )
    assert "reconcile_interrupted_jobs" in _called_names(_WORKER), (
        "nothing reconciles interrupted jobs any more"
    )


def test_enqueueing_never_drains_in_the_enqueueing_process() -> None:
    """The subtlest way to undo this whole ticket, found by a deadlocking test.

    Ticket 09's `enqueue_manual_single_sync` fired a local drain right after
    sending, so the common case paid no queue latency. That was right while the
    enqueueing process *was* the consumer. It is precisely wrong now: `POST
    /jobs/sync` and bulk follow both run in the API process, so a local kick
    puts the scraping back in the tier ticket 10 removed it from — and nothing
    would look broken, because the sync still happens and the stream still
    updates. It would just die on every deploy again, which is the bug.

    The kick is a `NOTIFY` instead, and this asserts the local call did not
    creep back into `enqueue_sync_job`.
    """
    from app.jobs import sync_queue

    source = inspect.getsource(sync_queue.enqueue_sync_job)
    for forbidden in ("drain_sync_lanes", "_guarded_drain"):
        assert forbidden not in source, (
            f"`enqueue_sync_job` calls {forbidden} — whichever process enqueues "
            "would run the sync, including the API. Ring the worker instead."
        )
    assert "publish" in source, (
        "`enqueue_sync_job` no longer rings the worker, so a queued sync waits "
        f"for the {settings.SYNC_QUEUE_POLL_INTERVAL_SECONDS}s sweep"
    )
    assert "start_lane_consumer" not in _called_names(_MAIN), (
        "the API process consumes the sync lanes — that is the worker's job"
    )
    assert "start_lane_consumer" in _called_names(_WORKER), (
        "nothing consumes the sync lanes on a ring; every sync now waits for "
        "the periodic sweep"
    )


def test_the_api_asks_the_worker_to_run_a_job_rather_than_running_it() -> None:
    """`POST /jobs/{id}/trigger` used to call the runner in-process.

    That was fine while the API *was* the job runner. After ticket 10 it means
    the API tier sweeping retention, or running the Discover probe — which
    fetches `t.me` — on a button press, contradicting `app/worker.py`'s "the API
    must never learn to scrape". `request_job_run` rings the worker instead and
    waits for it to report back.

    The `_job_status` read path has the mirror-image problem: it is filled in by
    whichever process runs the jobs, so without the announcements the Jobs panel
    reports `idle`/`null` for everything, forever, with nothing in error.
    """
    from app.api.routes import jobs as jobs_route

    called = _called_names(pathlib.Path(inspect.getfile(jobs_route)))
    assert "trigger_job" not in called, (
        "the API runs scheduler jobs in-process again — retention and the probe "
        "sweep would run in the API tier. Use request_job_run."
    )
    assert "request_job_run" in called, (
        "the trigger endpoint no longer asks the worker to run the job"
    )
    assert "start_job_status_subscriber" in _called_names(_MAIN), (
        "the API does not subscribe to scheduler status, so GET /jobs/status "
        "will report idle/null for every job forever"
    )
    assert "start_job_trigger_consumer" in _called_names(_WORKER), (
        "the worker ignores run requests, so the trigger endpoint does nothing"
    )


def test_the_sync_tier_is_a_single_replica() -> None:
    """The invariant that replaced "one API worker runs the scheduler".

    `proxy_pool`'s semaphores are per-process, so two worker replicas do not
    double throughput — they double the request rate at each proxy. The compose
    service says `replicas: 1`; this is what notices when someone raises it.
    """
    compose = (_BACKEND.parent / "compose.yml").read_text()
    assert "python -m app.worker" in compose, (
        "no compose service runs the sync worker; the scheduler is not running "
        "anywhere in a deployed stack"
    )
    worker_block = compose.split("\n  worker:", 1)[1].split("\n  frontend:", 1)[0]
    assert "replicas: 1" in worker_block, (
        "the sync worker is no longer pinned to one replica — see "
        f"{_PLAN.name} step 3 before raising it"
    )


def test_the_job_registry_is_still_a_dict_in_one_process() -> None:
    """Reason 2, now half of what it was. `has_active_sync_job` and the SSE
    stream both read this.

    Across processes it silently answers for one worker only: the scheduler
    cannot tell that a manual sync is already running, and a progress stream
    served by a different worker sees nothing to push.

    **The per-channel half of this reason is gone** (ticket 11). It used to
    assert `scraper_jobs._channel_locks` too — an `asyncio.Lock` per channel
    name, which was the only thing stopping two syncs of one Channel from
    interleaving their cursor writes. That moved to a claim on `tg_channels`,
    so it now holds across processes and the lock was deleted rather than left
    beside it: two answers to "is this Channel being synced" diverge the moment
    the second worker arrives, and which one a call site consulted would decide
    whether the cursors were protected.

    So this guard shrank on purpose, and the test below is what it shrank into.
    The job *registry* is still per-process and still a reason.
    """
    assert isinstance(scraper_jobs._active_jobs, dict)
    assert "_active_jobs" in inspect.getsource(scraper_jobs.has_active_sync_job), (
        "`has_active_sync_job` no longer reads in-process state — if the claim "
        f"moved to the database, see {_PLAN.name} step 2"
    )


def test_the_per_channel_claim_is_no_longer_in_process_memory() -> None:
    """The other half of reason 2, asserted from the other side (ticket 11).

    Deleting the `_channel_locks` assertion above without putting anything in
    its place would quietly drop a documented reason: the file would still list
    three, and only two would be checked. This is the replacement, and it fails
    in the direction that matters — if somebody reintroduces an in-process lock
    beside the database claim, the drift is caught here rather than discovered
    when a second worker interleaves a backfill.
    """
    assert not hasattr(scraper_jobs, "_channel_locks"), (
        "an in-process per-channel lock is back alongside the database claim; "
        "see tests/services/test_channel_mutual_exclusion.py"
    )

    from app.models_tg import Channel

    assert hasattr(Channel, "sync_claimed_at") and hasattr(
        Channel, "sync_claimed_by"
    ), (
        "the per-Channel sync claim is not on the row any more — mutual "
        "exclusion is back to being per-process, and the sync tier cannot be "
        f"scaled at all until it returns (see {_PLAN.name})"
    )


def test_proxy_concurrency_is_still_capped_per_process() -> None:
    """Reason 3, and the one with teeth.

    The other two cost duplicated work. This one changes behaviour *at Telegram*:
    the lane semaphores are `asyncio.Semaphore`, so N workers permit N times the
    configured requests through the same proxy. Scaling out without a shared
    limiter does not slow the system down, it gets the proxies blocked.
    """
    source = inspect.getsource(proxy_pool)

    assert "asyncio.Semaphore" in source, (
        "proxy lanes are no longer gated by an in-process semaphore — if the "
        f"limit is now shared across processes, {_PLAN.name} step 3 is done"
    )


def test_the_plan_for_lifting_this_exists() -> None:
    """Every message above points at it; a dangling reference would make this
    guard a dead end instead of a signpost."""
    assert _PLAN.is_file(), f"{_PLAN} is missing"

    text = _PLAN.read_text()
    for anchor in ("proxy", "LISTEN", "scheduler"):
        assert anchor in text, f"the plan no longer covers {anchor!r}"


@pytest.mark.parametrize("path", [_DOCKERFILE, _MAIN], ids=["dockerfile", "main"])
def test_the_files_this_guard_reads_exist(path: pathlib.Path) -> None:
    """A moved file would make every assertion above vacuous rather than red."""
    assert path.is_file(), f"{path} moved; this guard is now blind"


def test_prestart_runs_the_chat_backfill() -> None:
    """The chat move has to happen on deploy, not by hand.

    `a9b0c1d2e3f4` creates `tg_chat_sessions`; until the backfill runs, every
    existing chat is still a `tg_summaries` row that History renders as a
    summary with an empty body. A deploy is the only moment the schema and the
    data are guaranteed to be in step, so the two run together.

    Asserted because it is easy to drop: the script began life as an
    operator-run tool precisely *because* it deletes rows, and its own docstring
    argues for that. Anyone reading only the docstring would remove this line.
    """
    prestart = (
        pathlib.Path(__file__).resolve().parents[2] / "scripts" / "prestart.sh"
    ).read_text()

    assert "alembic upgrade head" in prestart
    assert "backfill_chat_sessions.py" in prestart
    # Order matters: the tables must exist before anything writes to them.
    assert prestart.index("alembic upgrade head") < prestart.index(
        "backfill_chat_sessions.py"
    )
    # No `|| true`. A half-migrated database that boots anyway is worse than a
    # deploy that stops and says why.
    backfill_line = next(
        line for line in prestart.splitlines() if "backfill_chat_sessions.py" in line
    )
    assert "||" not in backfill_line
