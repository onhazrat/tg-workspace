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
2. the three pieces of per-process state that make >1 wrong are still
   per-process.

Externalise them and (2) fails, which is the point: the failure message is the
notification that the constraint is lifted, not an obstacle to lifting it. The
sequenced plan is `docs/scaling-to-multiple-workers.md`.
"""

from __future__ import annotations

import inspect
import pathlib
import re

import pytest

from app.services import proxy_pool, scraper_jobs

_BACKEND = pathlib.Path(__file__).resolve().parents[2]
_DOCKERFILE = _BACKEND / "Dockerfile"
_MAIN = _BACKEND / "app" / "main.py"
_PLAN = _BACKEND.parent / "docs" / "scaling-to-multiple-workers.md"


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


def test_the_scheduler_still_starts_inside_the_api_process() -> None:
    """Reason 1. While the lifespan starts APScheduler, worker count *is* tick
    multiplier — there is nothing else deciding who owns the schedule."""
    assert "start_scheduler" in _MAIN.read_text(), (
        "the API process no longer starts the scheduler — if it moved to its own "
        f"single-replica service, this guard and the Dockerfile should be revisited "
        f"together ({_PLAN.name})"
    )


def test_the_job_registry_is_still_a_dict_in_one_process() -> None:
    """Reason 2. `has_active_sync_job` and the SSE stream both read this.

    Across processes it silently answers for one worker only: the scheduler
    cannot tell that a manual sync is already running, and a progress stream
    served by a different worker sees nothing to push.
    """
    assert isinstance(scraper_jobs._active_jobs, dict)
    assert isinstance(scraper_jobs._channel_locks, dict)
    assert "_active_jobs" in inspect.getsource(scraper_jobs.has_active_sync_job), (
        "`has_active_sync_job` no longer reads in-process state — if the claim "
        f"moved to the database, see {_PLAN.name} step 2"
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
