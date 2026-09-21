"""The corpus backfill (CRG-04).

An operator tool run by hand, once, against a live database holding millions
of rows — the kind of code that goes untested and is then discovered broken at
the worst possible moment. `tests/scripts/test_backfill_channel_follows.py`
says the same thing about the other backfill and is the shape this follows.

What is asserted here is only what the **loop** adds. Extraction, deferral,
the grace rule and the uniqueness constraint are `extract_batch`'s and are
asserted in `tests/services/test_post_references.py`; re-asserting them
through the script would pin the same behaviour twice and let the two
disagree about which one is the authority.

So: a dry run writes nothing and reports the population, the loop drains the
corpus in more than one batch, a second run is a clean zero rather than a
duplicate-key crash, an interrupted run resumes, and the deferred and skipped
counts reach both the per-batch line and the total.

## Watched to fail

* write inside the `if dry_run` branch → the dry-run test fails
* break out of the loop after the first batch → the multi-batch test fails
  with a short row count, and the second-run test stays green, which is why
  both exist
* keep the first batch's `deferring_channels` instead of the reading that ends
  the loop → the gauge test fails. Seeding it *before* the loop instead is not
  a mutation at all, because the terminating read overwrites it, which is the
  property the test is really about
* count only the eligible Posts in `pending_counts.pending` → the dry-run
  test's `deferred` goes to zero
* drop `_eligible` from `pending_counts` → the dry run claims the deferred
  Post is readable and disagrees with the run that follows it
* drop the per-batch `logger.info`, or demote the final one to `debug` → the
  progress-output test fails on each half separately
* put the dry run's `eligible`/`deferred` into `Totals.scanned`/`skipped` →
  the dry-run test fails. They are different populations under the run's
  names, and the suite used to pass either way because both fixtures happened
  to answer 1
* split `pending_counts` back into two `count()` calls → the one-statement
  test fails. Its own docstring says why that is asserted structurally rather
  than by staging the race
"""

from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import event
from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Channel, Post, PostReference
from app.services import post_references
from app.services.post_references import extract_batch, pending_counts
from app.services.settings_registry import REFERENCE_GRAPH_KEY
from app.services.settings_store import put_global_setting

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from backfill_post_references import backfill  # noqa: E402

#: A Channel whose chat id is known: its Posts are readable now.
KNOWN = "crg04known"
#: No chat id and a recent Post: deferred, inside the grace, not selected.
DEFERRING = "crg04deferring"
#: No chat id and a Post older than the grace: read, given up on, marked.
EXPIRED = "crg04expired"

#: `KNOWN` holds three Posts, each naming one Channel once.
EXPECTED_ROWS = 3


def _ms(*, days_ago: float = 0) -> int:
    return int((datetime.now(UTC) - timedelta(days=days_ago)).timestamp() * 1000)


def _seed() -> None:
    with Session(engine) as session:
        # The grace floor, written in production by CRG-01's migration and
        # cleared here by the per-test truncate. Seeded explicitly rather than
        # left absent: a freshly migrated database still carries the
        # migration's own row, whose `epochMs` is ~now, while an absent row
        # reads as 0 — so a fixture relying on the clearing passes or fails
        # depending on how recently the test database was created.
        put_global_setting(session, REFERENCE_GRAPH_KEY, {"epochMs": _ms(days_ago=60)})
        session.add(Channel(id=KNOWN, name=KNOWN, telegram_chat_id=4001))
        session.add(Channel(id=DEFERRING, name=DEFERRING, telegram_chat_id=None))
        session.add(Channel(id=EXPIRED, name=EXPIRED, telegram_chat_id=None))
        for post_id in (1, 2, 3):
            session.add(
                Post(
                    channel_name=KNOWN,
                    post_id=post_id,
                    text=f"see https://t.me/target{post_id}",
                    timestamp=_ms(days_ago=1),
                )
            )
        session.add(
            Post(
                channel_name=DEFERRING,
                post_id=1,
                text="see https://t.me/targetdeferred",
                timestamp=_ms(days_ago=1),
            )
        )
        session.add(
            Post(
                channel_name=EXPIRED,
                post_id=1,
                text="see https://t.me/targetexpired",
                # Older than both the seven-day grace and the epoch above, so
                # the walk reads it and gives up on it.
                timestamp=_ms(days_ago=30),
            )
        )
        session.commit()


def _rows() -> list[PostReference]:
    with Session(engine) as session:
        return list(session.exec(select(PostReference)).all())


def test_a_dry_run_reports_the_population_and_writes_nothing() -> None:
    """The counts an operator reads before committing to a multi-hour run."""
    _seed()

    totals = backfill(dry_run=True, batch_size=100)

    assert _rows() == []
    with Session(engine) as session:
        counts = pending_counts(session)
    assert counts.pending == 5
    # Three readable now, plus the expired one the walk reads to give up on.
    assert counts.eligible == 4
    assert counts.deferred == 1
    assert counts.deferring_channels == 2
    # Only the gauge crosses into `Totals`. A dry run's `deferred` is Posts the
    # walk would not read; a run's `skipped` is Posts it read and gave up on.
    # Putting the first in the second's field makes the real run look like it
    # lost the difference.
    assert (totals.scanned, totals.written, totals.skipped) == (0, 0, 0)
    assert totals.deferring_channels == 2


def test_the_two_pending_counts_are_one_statement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Asserted structurally, because the failure needs a second writer.

    Two counts would take two snapshots under READ COMMITTED, and the scraper
    inserts pending Posts the whole time a dry run is reading. `eligible`
    would pick up rows `pending` never saw and `deferred`, the subtraction,
    would print **negative** on the line an operator uses to decide whether to
    run at all. Reproducing that needs a concurrent inserter landing between
    the two statements, which is a race a single-threaded test cannot stage —
    so what is asserted is that there is no "between".

    Mutation: split `pending_counts` back into two `count()` calls and this
    fails with 2.
    """
    _seed()
    executed: list[str] = []

    @event.listens_for(engine, "before_cursor_execute")
    def record(conn, cursor, statement, *args) -> None:  # noqa: ANN001, ARG001
        executed.append(statement)

    # Stubbed, because its `EXISTS` names `references_extracted` too and it is
    # a different question — how many Channels are holding a Post back, not
    # how many Posts there are. Leaving it in would make the probe below count
    # two statements whatever `pending_counts` does.
    with monkeypatch.context() as patched:
        patched.setattr(post_references, "_deferring_channels", lambda session: 0)
        try:
            with Session(engine) as session:
                counts = pending_counts(session)
        finally:
            event.remove(engine, "before_cursor_execute", record)

    over_pending_posts = [
        statement for statement in executed if "references_extracted" in statement
    ]
    assert len(over_pending_posts) == 1
    # Still the right answers, so the collapse is not a shortcut past the work.
    assert (counts.pending, counts.eligible, counts.deferred) == (5, 4, 1)


def test_the_loop_drains_the_corpus_across_batches() -> None:
    """More batches than one, because a single call is not a backfill."""
    _seed()

    totals = backfill(dry_run=False, batch_size=2)

    assert totals.batches > 1
    assert totals.scanned == 4
    assert totals.written == EXPECTED_ROWS
    assert len(_rows()) == EXPECTED_ROWS


def test_a_second_run_writes_nothing() -> None:
    """Idempotent by the flag, not by a marker somebody has to remember."""
    _seed()
    backfill(dry_run=False, batch_size=100)

    again = backfill(dry_run=False, batch_size=100)

    assert again.batches == 0
    assert again.written == 0
    assert len(_rows()) == EXPECTED_ROWS


def test_an_interrupted_run_resumes_without_duplicating() -> None:
    """A committed batch is kept and a re-run picks up the rest of the walk."""
    _seed()
    with Session(engine) as session:
        first = extract_batch(session, limit=2)
    assert first.scanned == 2

    totals = backfill(dry_run=False, batch_size=100)

    assert totals.scanned == 2
    rows = _rows()
    assert len(rows) == EXPECTED_ROWS
    keys = [(r.source_post_id, r.target_handle, r.kind) for r in rows]
    assert len(set(keys)) == len(keys)


def test_the_skipped_and_deferring_counts_reach_every_progress_line(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Per batch and as a total, because a gap nobody prints is a gap nobody sees."""
    _seed()

    with caplog.at_level(logging.INFO, logger="backfill_post_references"):
        totals = backfill(dry_run=False, batch_size=2)

    lines = [record.getMessage() for record in caplog.records]
    assert sum(line.startswith("batch ") for line in lines) == totals.batches
    assert any("skipped=1" in line and line.startswith("batch ") for line in lines)
    done = next(line for line in lines if line.startswith("done:"))
    assert "skipped=1" in done
    assert totals.skipped == 1


def test_the_deferring_channel_count_is_read_after_the_walk_not_before() -> None:
    """The gauge an operator acts on is the one left standing at the end.

    Before the run, `EXPIRED` and `DEFERRING` both look like Channels holding
    a Post back. Only one of them is: `EXPIRED`'s Post is past its grace, so
    the walk reads it, gives up on it and marks it, and it drops out. Reading
    the gauge before or during the walk hands the operator a list with a
    Channel on it that needs nothing done about it.
    """
    _seed()

    before = backfill(dry_run=True, batch_size=2).deferring_channels

    totals = backfill(dry_run=False, batch_size=2)

    assert before == 2
    assert totals.batches > 1
    assert totals.deferring_channels == 1
