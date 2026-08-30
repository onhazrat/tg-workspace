"""Listing logs must not read the bodies the viewer only shows on expand.

`GET /data/logs/sync` returned **56.28 MB for one page of 500 rows, 99.7% of it
request/response bodies**, in 0.87 s of server time — a transfer problem, not a
query one. The viewer renders none of it until a row is expanded, and it expands
one row at a time.

Same defect and same shape as `test_summary_list_payload_cost.py`, one level
down: `tg_sync_log_payloads` already existed (so the bodies could be *truncated*
to reclaim disk), and the list joined it back in anyway.

## Asserted in both directions

Following `frontend/src/api/client-split.conform.ts`. Pinning only "the list is
small" would pass just as well if the detail route had been deleted along with
the bodies, so each type asserts:

1. the **list** does not carry its heavy keys,
2. the **detail** route does — the data still exists and is still reachable,
3. for sync, the list SQL does not mention the payload table at all, which is
   the difference between not *shipping* the bodies and not *reading* them.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.services.logs import (
    LOG_HEAVY_COLUMNS,
    get_log,
    list_logs,
    upsert_llm_log,
    upsert_publish_log,
    upsert_sync_log,
)
from app.services.serialization import to_camel

PAYLOAD_TABLE = "tg_sync_log_payloads"

#: Big enough that shipping 500 of them is the difference the endpoint showed.
BODY = {"messages": ["x" * 512 for _ in range(20)]}

#: Whose page this is. Payload size is not a tenancy question, and this file has
#: no opinion about the owner — but `list_logs` demands one with no default
#: (ticket 18), on the reasoning that a caller who has not decided whose rows it
#: wants should have to say so. Which rows come back for which account is
#: `test_log_tenancy_scoping.py`'s subject, not this one's.
VIEWER = uuid.uuid4()


@contextmanager
def captured_sql() -> Iterator[list[str]]:
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


def _seed(session: Session, log_id: str, log_type: str) -> None:
    common = {"id": log_id, "timestamp": 1_700_000_000_000, "status": "success"}
    if log_type == "sync":
        upsert_sync_log(
            session,
            {
                **common,
                "channel_name": "ch",
                "full_request": {"u": 1},
                "full_response": BODY,
            },
        )
    elif log_type == "publish":
        upsert_publish_log(
            session,
            {
                **common,
                "summary_id": "s",
                "bot_id": "b",
                "bot_name": "B",
                "chat_id": "c",
                "chat_name": "C",
                "full_request": {"u": 1},
                "full_response": BODY,
                "text_sent": "x" * 4000,
            },
            VIEWER,
        )
    else:
        upsert_llm_log(
            session,
            {
                **common,
                "model": "m",
                "prompt": "p" * 8000,
                "response": "r" * 8000,
                "system_instruction": "s" * 500,
                "full_request": {"u": 1},
                "full_response": BODY,
            },
            VIEWER,
        )
    session.commit()


@pytest.mark.parametrize("log_type", ["sync", "publish", "llm"])
def test_the_list_omits_the_heavy_keys_and_the_detail_carries_them(
    log_type: str,
) -> None:
    with Session(engine) as session:
        _seed(session, f"cost-{log_type}", log_type)

        listed = next(
            row
            for row in list_logs(session, log_type, user_id=VIEWER)
            if row["id"] == f"cost-{log_type}"
        )
        detail = get_log(session, log_type, f"cost-{log_type}", user_id=VIEWER)

    heavy_wire_keys = {to_camel(c) for c in LOG_HEAVY_COLUMNS[log_type]} or {
        "fullRequest",
        "fullResponse",
    }
    assert heavy_wire_keys.isdisjoint(listed), (
        f"{log_type} list still carries {heavy_wire_keys & set(listed)}"
    )
    assert heavy_wire_keys <= set(detail), (
        f"{log_type} detail lost {heavy_wire_keys - set(detail)}"
    )


def test_listing_sync_logs_never_opens_the_payload_table() -> None:
    """Not shipping the bodies is not the same as not reading them.

    Filtering them out in the serialiser would leave this assertion red, which
    is the point: the join has to be gone from the query.
    """
    with Session(engine) as session:
        _seed(session, "cost-sync-sql", "sync")

        with captured_sql() as statements:
            list_logs(session, "sync", user_id=VIEWER)

    assert statements, "no SQL captured — the listener is not wired up"
    offenders = [s for s in statements if PAYLOAD_TABLE in s]
    assert not offenders, f"the list read the payload table: {offenders}"


def test_the_detail_route_does_open_it() -> None:
    """The other direction — proof the guard above can see that table at all."""
    with Session(engine) as session:
        _seed(session, "cost-sync-detail", "sync")

        with captured_sql() as statements:
            detail = get_log(session, "sync", "cost-sync-detail", user_id=VIEWER)

    assert detail["fullResponse"] == BODY
    assert any(PAYLOAD_TABLE in s for s in statements)


def test_a_full_page_of_bodies_still_serialises_small() -> None:
    """The measurement that started this, in miniature.

    Fifty rows carrying ~10 kB of body each; the list must not scale with them.
    """
    with Session(engine) as session:
        for i in range(50):
            _seed(session, f"cost-bulk-{i:03}", "sync")

        page = list_logs(session, "sync", limit=500, user_id=VIEWER)

    assert len(page) >= 50
    assert len(json.dumps(page)) < 50_000


def test_the_heavy_sets_are_not_silently_empty() -> None:
    """`LOG_HEAVY_COLUMNS` with everything emptied would pass every test above
    except this one — sync's set is legitimately empty (its bodies are in
    another table), but publish's and llm's are not."""
    assert LOG_HEAVY_COLUMNS["publish"]
    assert LOG_HEAVY_COLUMNS["llm"]
    assert not LOG_HEAVY_COLUMNS["sync"], "sync's bodies are not columns of its table"


# --- the search that moved to SQL -------------------------------------------
#
# The Logs view matched the query in the browser over the fetched page. It
# cannot any more: the bodies are not there. These pin the behaviour that moved
# rather than letting it quietly disappear — including the two cases the client
# tests used to own, `textSent` and the LLM prompt, which are exactly the fields
# that are searchable-but-not-shipped now.


def test_search_matches_fields_the_list_still_carries() -> None:
    with Session(engine) as session:
        _seed(session, "search-sync-a", "sync")

        assert [
            r["id"] for r in list_logs(session, "sync", search="ch", user_id=VIEWER)
        ] == ["search-sync-a"]
        assert (
            list_logs(session, "sync", search="nothing-matches-this", user_id=VIEWER)
            == []
        )


def test_search_matches_a_field_that_is_no_longer_shipped() -> None:
    """`textSent` and the LLM prompt: searchable, never sent.

    This is the whole justification for moving the match into SQL rather than
    dropping the feature with the payload.
    """
    with Session(engine) as session:
        _seed(session, "search-publish", "publish")
        _seed(session, "search-llm", "llm")

        found_text_sent = list_logs(session, "publish", search="xxxx", user_id=VIEWER)
        found_prompt = list_logs(session, "llm", search="pppp", user_id=VIEWER)

    assert [r["id"] for r in found_text_sent] == ["search-publish"]
    assert "textSent" not in found_text_sent[0]
    assert [r["id"] for r in found_prompt] == ["search-llm"]
    assert "prompt" not in found_prompt[0]


def test_bodies_are_matched_only_with_search_in_details() -> None:
    """The view's checkbox, now evaluated in SQL.

    Sync's bodies are in another table, so this is also the one case that has to
    go through an EXISTS rather than a column.
    """
    marker = BODY["messages"][0][:8]
    with Session(engine) as session:
        _seed(session, "search-details", "sync")

        without = list_logs(session, "sync", search=marker, user_id=VIEWER)
        with_details = list_logs(
            session, "sync", search=marker, search_in_details=True, user_id=VIEWER
        )

    assert [r["id"] for r in without] == []
    assert [r["id"] for r in with_details] == ["search-details"]


def test_a_blank_search_is_not_a_filter() -> None:
    with Session(engine) as session:
        _seed(session, "search-blank", "sync")

        assert list_logs(session, "sync", search="   ", user_id=VIEWER)
        assert list_logs(session, "sync", search=None, user_id=VIEWER)
