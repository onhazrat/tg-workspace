"""The unified artifact list must stay cheap across all four tables.

`/data/artifacts` unions `tg_summaries`, `tg_chat_sessions`, `tg_tag_runs` and
`tg_discover_reports`. Two of those keep a corpus in a companion payload table;
the other two keep it in the same table as their metadata. So there are two
distinct ways for this endpoint to become the 26 MB defect again, and both are
pinned here:

* opening `tg_summary_payloads` or `tg_chat_session_payloads` — which the
  service cannot do accidentally, because it never imports those models;
* selecting `TagRun.prompt_text` or `DiscoverReport.candidates` — which
  `select(Entity)` does for free, and which is exactly how `list_tag_runs` and
  `list_reports` were reading a corpus off disk before they were fixed.

Plus the invariant the whole chat migration exists to establish: **no artifact
appears twice.**
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import DiscoverReport
from app.services.artifacts import (
    ARTIFACT_FORBIDDEN_COLUMNS,
    ARTIFACT_KINDS,
    list_artifacts,
)
from app.services.chat_sessions import upsert_chat_session
from app.services.summaries import list_summaries, upsert_summary
from app.services.tag_runs import upsert_tag_run

PAYLOAD_TABLES = ("tg_summary_payloads", "tg_chat_session_payloads")


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


def _seed(session: Session, *, corpus: int = 100) -> None:
    """One artifact of each kind, each with something heavy behind it."""
    upsert_summary(
        session,
        "art-summary",
        {
            "text": "a summary body",
            "channels": ["a"],
            "timestamp": 400,
            "promptText": "x" * corpus,
            "citedPosts": [{"id": 1}],
        },
        user_id=None,
    )
    upsert_chat_session(
        session,
        "art-chat",
        {
            "channels": ["a"],
            "timestamp": 300,
            "messages": [{"role": "user", "text": "y" * corpus}],
        },
        user_id=None,
    )
    upsert_tag_run(
        session,
        "art-tag",
        {
            "channels": ["a"],
            "createdAt": 200,
            "promptText": "z" * corpus,
            "responseText": "w" * corpus,
        },
        user_id=None,
    )
    session.add(
        DiscoverReport(
            id="art-discovery",
            channels=["a"],
            candidates=[{"name": f"c{i}", "blurb": "q" * corpus} for i in range(20)],
            candidate_count=20,
            timestamp=100,
        )
    )
    session.commit()


def test_the_forbidden_set_is_not_silently_empty() -> None:
    """Without this, every column assertion below passes on an empty set."""
    assert {
        "prompt_text",
        "response_text",
        "suggestions",
        "candidates",
        "chat_messages",
        "messages",
    } <= ARTIFACT_FORBIDDEN_COLUMNS


@pytest.mark.parametrize("kind", [None, *ARTIFACT_KINDS])
def test_the_union_never_opens_either_payload_table(kind: str | None) -> None:
    with Session(engine) as session:
        _seed(session)

        with captured_sql() as statements:
            list_artifacts(session, kind=kind)

    assert statements, "no SQL captured — the listener is not wired up"
    for table in PAYLOAD_TABLES:
        offenders = [s for s in statements if table in s]
        assert not offenders, f"the union read {table}: {offenders}"


@pytest.mark.parametrize("column", sorted(ARTIFACT_FORBIDDEN_COLUMNS))
def test_the_union_never_selects_a_heavy_column(column: str) -> None:
    with Session(engine) as session:
        _seed(session)

        with captured_sql() as statements:
            list_artifacts(session)

    offenders = [s for s in statements if column in s]
    assert not offenders, f"the union selected {column}: {offenders}"


def test_each_artifact_appears_exactly_once() -> None:
    """The invariant the chat migration exists to establish.

    A chat extracted from a summary must not leave the summary also reporting
    itself as a chat — the pre-migration encoding derived `kind` from
    `text LIKE 'Chat: %'`, and this is the test that says no.
    """
    with Session(engine) as session:
        _seed(session)
        upsert_summary(
            session,
            "art-legacy-looking",
            {
                "text": "Chat: this text merely looks like one",
                "channels": ["a"],
                "timestamp": 500,
            },
            user_id=None,
        )

        page = list_artifacts(session)

    keys = [(row["kind"], row["id"]) for row in page]
    assert len(keys) == len(set(keys)) == 5
    assert ("summary", "art-legacy-looking") in keys
    assert ("chat", "art-legacy-looking") not in keys


def test_kinds_carry_only_their_own_fields() -> None:
    """No invented nulls: this is why the response is a discriminated union."""
    with Session(engine) as session:
        _seed(session)
        by_kind = {row["kind"]: row for row in list_artifacts(session)}

    assert "status" in by_kind["summary"]
    assert "messageCount" not in by_kind["summary"]
    assert "candidateCount" not in by_kind["summary"]
    # The summary controls History renders, read from the same `extra` the
    # star already comes out of.
    assert by_kind["summary"]["autoRegenerate"] is False
    assert by_kind["summary"]["autoPublish"] is False
    # ...and only on summaries: a tag run has no such thing.
    assert "autoRegenerate" not in by_kind["tag"]
    assert "language" not in by_kind["discovery"]

    assert by_kind["chat"]["messageCount"] == 1
    assert by_kind["chat"]["mode"] == "full_scope"
    assert "status" not in by_kind["chat"]

    assert by_kind["discovery"]["candidateCount"] == 20
    assert "mode" not in by_kind["discovery"]


def test_ordering_is_stable_across_pages() -> None:
    """Concatenated pages must equal one big page — no gaps, no duplicates.

    Every row shares one timestamp *and* the rows come from different legs, so
    the interleaving is decided by the tiebreak alone. Without cross-leg
    collisions this test passes even with the tiebreak removed: each leg is
    already sorted internally, so a single-kind page comes back ordered by
    accident.
    """
    with Session(engine) as session:
        for i in range(6):
            upsert_summary(
                session,
                f"art-page-s{i}",
                {"text": "t", "channels": [], "timestamp": 7},
                user_id=None,
            )
            upsert_chat_session(
                session,
                f"art-page-c{i}",
                {"channels": [], "timestamp": 7},
                user_id=None,
            )

        whole = [row["id"] for row in list_artifacts(session, limit=12)]
        paged: list[str] = []
        for offset in range(0, 12, 4):
            paged += [
                row["id"] for row in list_artifacts(session, limit=4, offset=offset)
            ]

    assert paged == whole
    assert len(set(paged)) == 12


def test_the_outer_sort_carries_the_tiebreak() -> None:
    """Structural, because the behavioural test above cannot see this alone.

    Paging over colliding timestamps *usually* looks fine without an id
    tiebreak — Postgres is free to return equal rows in any order but rarely
    reshuffles a small result set between two identical queries. So the
    guarantee is asserted where it actually lives: in the emitted ORDER BY.
    """
    with Session(engine) as session:
        _seed(session)

        with captured_sql() as statements:
            list_artifacts(session)

    outer = [s for s in statements if "ORDER BY" in s and "artifact" in s]
    assert outer, "no union query captured"
    tail = outer[-1].rsplit("ORDER BY", 1)[1]
    assert "id" in tail, f"the union's outer sort has no id tiebreak: {tail}"


def test_the_kind_filter_removes_the_table_from_the_plan() -> None:
    """`?kind=chat` must not put the other three tables in the query at all."""
    with Session(engine) as session:
        _seed(session)

        with captured_sql() as statements:
            page = list_artifacts(session, kind="chat")

    assert [row["kind"] for row in page] == ["chat"]
    union_sql = [s for s in statements if "tg_chat_sessions" in s]
    assert union_sql
    for other in ("tg_summaries", "tg_tag_runs", "tg_discover_reports"):
        assert not any(other in s for s in union_sql), f"{other} was still in the plan"


def test_search_matches_per_kind() -> None:
    with Session(engine) as session:
        _seed(session)

        assert [r["id"] for r in list_artifacts(session, search="a summary body")] == [
            "art-summary"
        ]
        assert [r["id"] for r in list_artifacts(session, search="add")] == ["art-tag"]


def test_search_deliberately_does_not_reach_prompt_bodies() -> None:
    """Both directions in one test, so the narrowing stays a decision.

    `/data/summaries?search=` still finds a prompt-only match — the capability
    exists. `/data/artifacts?search=` does not, **and** opens no payload table
    on the way to not finding it. Add the `EXISTS` back and the first assertion
    keeps passing while the other two fail.
    """
    with Session(engine) as session:
        upsert_summary(
            session,
            "art-prompt-only",
            {
                "text": "nothing here",
                "channels": [],
                "timestamp": 1,
                "promptText": "xyzzy",
            },
            user_id=None,
        )

        assert [r["id"] for r in list_summaries(session, search="xyzzy")] == [
            "art-prompt-only"
        ]

        with captured_sql() as statements:
            found = list_artifacts(session, search="xyzzy")

    assert found == []
    for table in PAYLOAD_TABLES:
        assert not any(table in s for s in statements)


def test_a_page_of_corpora_still_serialises_small() -> None:
    """Bytes, not seconds: wall clock would flake on a loaded machine."""
    with Session(engine) as session:
        _seed(session, corpus=200_000)

        page = list_artifacts(session)

    assert len(page) == 4
    assert len(json.dumps(page)) < 20_000


def test_starring_spans_every_kind() -> None:
    """A filter that worked on half the list would be worse than none."""
    with Session(engine) as session:
        _seed(session)
        upsert_tag_run(session, "art-tag", {"isStarred": True}, user_id=None)

        starred = {row["id"] for row in list_artifacts(session) if row["isStarred"]}

    assert starred == {"art-tag"}


def test_the_starred_filter_runs_in_sql() -> None:
    """Not in the browser, because paging makes that wrong.

    Filtering fetched pages client-side looks cheaper — it only narrows what is
    on screen — but with no starred rows in the loaded pages the list renders
    empty, the infinite-scroll sentinel stays in view, and each fetch triggers
    the next: the browser walks the whole history back to back while showing
    "no matches". Doing it in SQL means a page of starred rows is a page.
    """
    with Session(engine) as session:
        _seed(session)
        upsert_tag_run(session, "art-tag", {"isStarred": True}, user_id=None)
        upsert_summary(
            session,
            "art-starred-summary",
            {"text": "s", "channels": [], "timestamp": 900, "isStarred": True},
            user_id=None,
        )

        page = list_artifacts(session, starred=True)

    assert {row["id"] for row in page} == {"art-tag", "art-starred-summary"}
    assert all(row["isStarred"] for row in page)


def test_the_starred_filter_spans_kinds_and_respects_kind() -> None:
    with Session(engine) as session:
        _seed(session)
        upsert_tag_run(session, "art-tag", {"isStarred": True}, user_id=None)

        assert [r["id"] for r in list_artifacts(session, kind="tag", starred=True)] == [
            "art-tag"
        ]
        assert list_artifacts(session, kind="chat", starred=True) == []
