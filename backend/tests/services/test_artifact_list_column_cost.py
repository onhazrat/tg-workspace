"""Two list endpoints that were reading a corpus off disk to throw it away.

`tg_summaries` and `tg_sync_logs` each got a companion payload table and a guard
after they shipped 26 MB and 56 MB pages. `tg_tag_runs` and
`tg_discover_reports` never did — and both kept their corpus-sized columns in
the *same* table as their metadata, where `select(Entity)` reads them
unconditionally:

* `list_tag_runs` did `select(TagRun)` and dropped `promptText` /
  `responseText` / `suggestions` in **Python**. The wire payload looked correct,
  so nothing pointed at it; every historical prompt corpus was still detoasted
  on every call.
* `report_to_camel_light` computed `candidateCount` as `len(report.candidates)`
  — detoasting the whole candidate array of every row on the page to produce one
  integer.

Neither had a guard, which is why they survived two rounds of exactly this fix
happening elsewhere.

## Assert the reason, not just the state

`candidate_count` is only allowed to be a stored column *because* it provably
equals the thing it replaced. A guard that pinned "the list does not read
`candidates`" alone would stay green while the column drifted and every report
reported zero candidates from a query that is technically cheap.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import DiscoverReport, TagRun
from app.services.discover_reports import (
    HEAVY_REPORT_COLUMNS,
    get_report,
    list_reports,
)
from app.services.tag_runs import (
    HEAVY_TAG_RUN_COLUMNS,
    get_tag_run,
    list_tag_runs,
    upsert_tag_run,
)
from tests.utils.tenancy import ANY_READER


@contextmanager
def captured_sql() -> Iterator[list[str]]:
    """Every statement the engine executes inside the block."""
    statements: list[str] = []

    def before_cursor_execute(
        conn: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


def _candidates(n: int, size: int) -> list[Any]:
    return [{"name": f"ch{i}", "blurb": "x" * size} for i in range(n)]


def _write_report(session: Session, report_id: str, candidates: list[Any]) -> None:
    report = DiscoverReport(
        id=report_id,
        user_id=ANY_READER,
        channels=["a"],
        candidates=candidates,
        candidate_count=len(candidates),
        timestamp=1,
    )
    session.add(report)
    session.commit()


def _write_tag_run(session: Session, run_id: str, **body: object) -> None:
    upsert_tag_run(session, run_id, {"channels": ["a"], **body}, user_id=ANY_READER)


def test_the_heavy_sets_are_not_silently_empty() -> None:
    """Without this, every assertion below passes on an empty frozenset."""
    assert {"prompt_text", "response_text", "suggestions"} <= HEAVY_TAG_RUN_COLUMNS
    assert "candidates" in HEAVY_REPORT_COLUMNS


@pytest.mark.parametrize("column", sorted(HEAVY_TAG_RUN_COLUMNS))
def test_listing_tag_runs_selects_no_heavy_column(column: str) -> None:
    with Session(engine) as session:
        _write_tag_run(
            session,
            "cols-tag",
            promptText="x" * 5000,
            responseText="y" * 5000,
            suggestions={"a": ["b"]},
        )

        with captured_sql() as statements:
            list_tag_runs(session, user_id=ANY_READER)

    assert statements, "no SQL captured — the listener is not wired up"
    offenders = [s for s in statements if column in s]
    assert not offenders, f"list_tag_runs selected {column}: {offenders}"


def test_the_tag_run_detail_call_still_returns_them() -> None:
    """The other direction: the columns were projected out, not deleted."""
    with Session(engine) as session:
        _write_tag_run(
            session, "cols-tag-detail", promptText="corpus", responseText="r"
        )

        full = get_tag_run(session, "cols-tag-detail", user_id=ANY_READER)

    assert full["promptText"] == "corpus"
    assert full["responseText"] == "r"


def test_listing_reports_never_reads_candidates() -> None:
    with Session(engine) as session:
        _write_report(session, "cols-report", _candidates(50, 500))

        with captured_sql() as statements:
            list_reports(session, user_id=ANY_READER)

    assert statements
    offenders = [s for s in statements if "candidates" in s]
    assert not offenders, f"list_reports selected candidates: {offenders}"


def test_the_stored_count_equals_the_thing_it_replaced() -> None:
    """The reason clause.

    `candidateCount` may come from a column only for as long as that column
    agrees with `len(candidates)`. Pin the cheap query without pinning this and
    the column is free to drift to zero unnoticed.
    """
    with Session(engine) as session:
        _write_report(session, "cols-count", _candidates(37, 10))

        listed = next(
            row
            for row in list_reports(session, user_id=ANY_READER)
            if row["id"] == "cols-count"
        )
        full = get_report(session, "cols-count", user_id=ANY_READER)

    assert listed["candidateCount"] == len(full["candidates"]) == 37


def test_a_page_of_corpora_still_serialises_small() -> None:
    """Bytes, not seconds: wall clock would flake on a loaded machine."""
    with Session(engine) as session:
        for i in range(5):
            _write_tag_run(session, f"cols-big-tag-{i}", promptText="x" * 200_000)
            _write_report(session, f"cols-big-report-{i}", _candidates(200, 1000))

        page = list_tag_runs(session, user_id=ANY_READER) + list_reports(
            session, user_id=ANY_READER
        )

    assert len(json.dumps(page)) < 50_000


def test_starring_works_on_both_kinds() -> None:
    """`extra` is why History's starred filter can span all four artifacts."""
    with Session(engine) as session:
        _write_tag_run(session, "cols-star-tag", isStarred=True)
        listed = next(
            row
            for row in list_tag_runs(session, user_id=ANY_READER)
            if row["id"] == "cols-star-tag"
        )

    assert listed["isStarred"] is True


def test_a_round_tripped_run_cannot_pin_its_own_timestamp() -> None:
    """`updatedAt` must reach the column, not the `extra` bag.

    `to_snake("updatedAt")` is `"updated_at"`, but the column is
    `updated_at_ms` — so the key passed the "is this a known column?" test,
    landed in `extra`, and because `extra` is spread *last* it shadowed the real
    value on every read. The frontend PUTs the whole run object on every save,
    so a client that had once read `updatedAt` pinned it forever while the
    column advanced underneath.
    """
    with Session(engine) as session:
        first = upsert_tag_run(
            session, "cols-roundtrip", {"channels": ["a"]}, user_id=ANY_READER
        )
        # Exactly what `upsertTagRun` does: send back what the list returned.
        second = upsert_tag_run(
            session, "cols-roundtrip", dict(first), user_id=ANY_READER
        )

        row = session.get(TagRun, "cols-roundtrip")
        assert row is not None

    assert second["updatedAt"] == row.updated_at_ms
    assert "updatedAt" not in (row.extra or {})
    assert "createdAt" not in (row.extra or {})
