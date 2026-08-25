"""Listing summaries must not open the table the corpus lives in.

`GET /data/summaries` took 2.69 s to return 49 rows because `citedPosts`,
`promptText` and `chatMessages` sat in `tg_summaries.extra`. TOAST is
all-or-nothing per value, so reading any key of `extra` detoasted all of it:
26 MB compressed per page to ship 1.15 MB, on every tab load. Splitting them
into `tg_summary_payloads` fixes that only for as long as the list query stays
out of that table.

## What is asserted, and in both directions

Following `frontend/src/api/client-split.conform.ts`: pinning only "the list
does not read it" would let someone quietly move the heavy fields back into
`extra` — the list would still not touch `tg_summary_payloads`, and the guard
would stay green while the 26 MB came back. So three things are pinned:

1. the **list** does not touch the payload table,
2. the **detail** call does — proving the guard can see the table at all, and
   that the split did not just delete the data,
3. the heavy fields are **not in `extra`** — the storage location itself.

The cost assertion is on bytes rather than seconds: a page of summaries with
5 MB of prompt text behind it must still serialise to a few kilobytes. Wall
clock would make this a flake on a loaded machine; the payload size is the
thing the browser actually waits for.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Summary, SummaryPayload
from app.services.summaries import (
    HEAVY_SUMMARY_FIELDS,
    delete_summary,
    get_summary,
    list_summaries,
    upsert_summary,
)
from tests.utils.tenancy import ANY_READER

PAYLOAD_TABLE = "tg_summary_payloads"


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


def _write(session: Session, summary_id: str, **body: object) -> None:
    upsert_summary(
        session,
        summary_id,
        {"text": "t", "channels": [], "timestamp": 1, **body},
        user_id=ANY_READER,
    )


def test_listing_does_not_touch_the_payload_table() -> None:
    with Session(engine) as session:
        _write(session, "cost-list", promptText="x" * 1000, citedPosts={"a": {"id": 1}})

        with captured_sql() as statements:
            list_summaries(session, user_id=ANY_READER)

    assert statements, "no SQL captured — the listener is not wired up"
    offenders = [s for s in statements if PAYLOAD_TABLE in s]
    assert not offenders, f"list_summaries read the payload table: {offenders}"


def test_the_detail_call_does_touch_it() -> None:
    """The other direction: without this, the guard above passes on no data."""
    with Session(engine) as session:
        _write(session, "cost-detail", promptText="hello")

        with captured_sql() as statements:
            body = get_summary(session, "cost-detail", user_id=ANY_READER)

    assert body["promptText"] == "hello"
    assert any(PAYLOAD_TABLE in s for s in statements)


def test_searching_opens_it_deliberately() -> None:
    """Searching prompt bodies means reading them; that is the whole trade.

    Pinned so the cost is a decision rather than a surprise — everything
    *except* search stays on the cheap path.
    """
    with Session(engine) as session:
        _write(session, "cost-search", promptText="a corpus containing xyzzy")

        with captured_sql() as statements:
            found = list_summaries(session, search="xyzzy", user_id=ANY_READER)

    assert [row["id"] for row in found] == ["cost-search"]
    assert any(PAYLOAD_TABLE in s for s in statements)


def test_heavy_fields_are_not_stored_in_extra() -> None:
    """The storage location, not just the query shape.

    Moving these back into `extra` would restore the original defect while
    leaving the "list does not read the payload table" assertion green.
    """
    with Session(engine) as session:
        _write(
            session,
            "cost-extra",
            promptText="corpus",
            citedPosts={"ch#1": {"id": 1}},
            chatMessages=[{"role": "user", "text": "hi"}],
            isStarred=True,
        )

        row = session.get(Summary, "cost-extra")
        assert row is not None
        assert set(row.extra or {}).isdisjoint(HEAVY_SUMMARY_FIELDS)
        assert (row.extra or {})["isStarred"] is True


def test_a_page_of_huge_prompts_still_serialises_small() -> None:
    """5 MB of prompt behind the page, a few kB on the wire."""
    prompt = "word " * 200_000  # ~1 MB
    with Session(engine) as session:
        for i in range(5):
            _write(session, f"cost-big-{i}", promptText=prompt, timestamp=i)

        with captured_sql() as statements:
            page = list_summaries(session, user_id=ANY_READER)

    assert len(page) >= 5
    assert not any(PAYLOAD_TABLE in s for s in statements)
    assert len(json.dumps(page)) < 50_000


def test_deleting_a_summary_takes_its_payload_with_it() -> None:
    """No FK to cascade from — see `SummaryPayload` — so this is explicit."""
    with Session(engine) as session:
        _write(session, "cost-del", promptText="corpus")
        assert session.get(SummaryPayload, "cost-del") is not None

        delete_summary(session, "cost-del", user_id=ANY_READER)

        assert session.get(SummaryPayload, "cost-del") is None


def test_a_summary_without_heavy_fields_gets_no_payload_row() -> None:
    with Session(engine) as session:
        _write(session, "cost-empty")

        assert session.get(SummaryPayload, "cost-empty") is None
