"""The one destructive step: moving chats out of `tg_summaries`.

`backfill_chat_sessions.py` deletes user artifacts, so it is a script an
operator runs rather than a migration `prestart.sh` runs unattended. That makes
these tests the only thing standing between a bad classification and someone's
history.

Two shapes exist in the data and they are treated differently, which is the
whole risk: a chat-only row must be **deleted** from `tg_summaries` (it was
never a summary), while a real summary someone chatted about must be **kept**
with its transcript extracted. Getting the classification backwards either
loses a summary or leaves a chat showing up twice.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import ChatSession, ChatSessionPayload, Summary, SummaryPayload
from app.services.summaries import get_summary, upsert_summary

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from backfill_chat_sessions import (  # noqa: E402  # ty: ignore[unresolved-import]
    backfill_chats,
)

from tests.utils.tenancy import ANY_READER

TURNS = [
    {"role": "user", "text": "what changed in the last week?"},
    {"role": "model", "text": "three things"},
]


def _write_summary(
    session: Session, summary_id: str, text: str, **body: object
) -> None:
    upsert_summary(
        session,
        summary_id,
        {"text": text, "channels": ["a"], "timestamp": 1, **body},
        user_id=ANY_READER,
    )


def test_a_chat_only_summary_becomes_a_chat_and_leaves_no_summary() -> None:
    with Session(engine) as session:
        _write_summary(
            session,
            "bf-chat-only",
            "Chat: what changed in the last week?",
            chatMessages=TURNS,
            isStarred=True,
        )

    counts = backfill_chats(dry_run=False, batch=10)
    assert counts["chatOnly"] == 1

    with Session(engine) as session:
        assert session.get(Summary, "bf-chat-only") is None
        assert session.get(SummaryPayload, "bf-chat-only") is None

        chat = session.get(ChatSession, "bf-chat-only")
        assert chat is not None
        assert chat.title == "what changed in the last week?"
        assert chat.message_count == 2
        # The small UI flags come along; they were the user's, not the
        # summary's.
        assert (chat.extra or {})["isStarred"] is True

        payload = session.get(ChatSessionPayload, "bf-chat-only")
        assert payload is not None
        assert payload.messages == TURNS


def test_a_summary_with_a_chat_keeps_the_summary_and_extracts_the_chat() -> None:
    with Session(engine) as session:
        _write_summary(
            session,
            "bf-both",
            "A real summary of the week.",
            chatMessages=TURNS,
            promptText="the corpus",
        )

    counts = backfill_chats(dry_run=False, batch=10)
    assert counts["summaryPlusChat"] == 1

    with Session(engine) as session:
        summary = session.get(Summary, "bf-both")
        assert summary is not None
        assert summary.text == "A real summary of the week."
        # The transcript is gone from the summary's half...
        assert summary.chat_message_count == 0
        # ...but the rest of its payload is untouched.
        assert (
            get_summary(session, "bf-both", user_id=ANY_READER)["promptText"]
            == "the corpus"
        )

        chat = session.get(ChatSession, "bf-both:chat")
        assert chat is not None
        assert chat.message_count == 2
        assert chat.title == TURNS[0]["text"]


def test_nothing_appears_twice() -> None:
    """The invariant the whole move exists to establish.

    A chat that showed up as both a summary row and a chat session would defeat
    the point of the unified history list.
    """
    with Session(engine) as session:
        _write_summary(session, "bf-dup-a", "Chat: hello", chatMessages=TURNS)
        _write_summary(session, "bf-dup-b", "Real summary", chatMessages=TURNS)

    backfill_chats(dry_run=False, batch=10)

    with Session(engine) as session:
        summaries = session.exec(select(Summary)).all()
        chats = session.exec(select(ChatSession)).all()

    assert [s.id for s in summaries] == ["bf-dup-b"]
    assert sorted(c.id for c in chats) == ["bf-dup-a", "bf-dup-b:chat"]
    # No summary still claims to carry a transcript.
    assert all(s.chat_message_count == 0 for s in summaries)


def test_it_is_idempotent() -> None:
    """A re-run must move nothing, not duplicate or re-delete."""
    with Session(engine) as session:
        _write_summary(session, "bf-twice", "Chat: hi", chatMessages=TURNS)

    first = backfill_chats(dry_run=False, batch=10)
    second = backfill_chats(dry_run=False, batch=10)

    assert first["chatOnly"] == 1
    assert second == {"chatOnly": 0, "summaryPlusChat": 0, "alreadyMoved": 0}

    with Session(engine) as session:
        assert len(session.exec(select(ChatSession)).all()) == 1


def test_a_dry_run_writes_nothing() -> None:
    """`--dry-run` is the only thing between an operator and a bad classification."""
    with Session(engine) as session:
        _write_summary(session, "bf-dry", "Chat: hi", chatMessages=TURNS)

    counts = backfill_chats(dry_run=True, batch=10)
    assert counts["chatOnly"] == 1

    with Session(engine) as session:
        # Reported as movable, still exactly where it was.
        assert session.get(Summary, "bf-dry") is not None
        assert session.exec(select(ChatSession)).all() == []


def test_a_summary_with_no_chat_is_left_alone() -> None:
    """A payload row is not a transcript.

    This is the test that caught the real bug. `chat_messages IS NOT NULL`
    looks like the obvious filter and is wrong: SQLAlchemy's `JSON` type
    serialises Python `None` to a JSON `null`, not an SQL NULL, so a payload
    written for `promptText` alone still satisfies it. Every summary with any
    payload was classified "summary + chat", and each one grew an empty chat
    session in history.
    """
    with Session(engine) as session:
        _write_summary(session, "bf-plain", "Just a summary", promptText="corpus")

    counts = backfill_chats(dry_run=False, batch=10)

    assert counts == {"chatOnly": 0, "summaryPlusChat": 0, "alreadyMoved": 0}
    with Session(engine) as session:
        assert session.get(Summary, "bf-plain") is not None
        assert session.exec(select(ChatSession)).all() == []


def test_an_empty_transcript_is_not_a_chat() -> None:
    """`chatMessages: []` is a chat someone opened and never used."""
    with Session(engine) as session:
        _write_summary(session, "bf-empty", "A summary", chatMessages=[])

    counts = backfill_chats(dry_run=False, batch=10)

    assert counts == {"chatOnly": 0, "summaryPlusChat": 0, "alreadyMoved": 0}
    with Session(engine) as session:
        assert session.exec(select(ChatSession)).all() == []


def test_a_dry_run_counts_every_chat_not_just_one_batch() -> None:
    """The whole point of `--dry-run` is a trustworthy count.

    Paging by "rows that still match" rather than by keyset looks correct and
    is not: a dry run rolls its writes back, so the second query returns the
    identical page and the loop stops after one. With the default `batch=200`,
    any install with more chats than that reported exactly 200 — while the
    script's reason for existing is showing an operator the number *before* it
    deletes rows.
    """
    with Session(engine) as session:
        for i in range(5):
            _write_summary(session, f"bf-batch-{i}", "Chat: hi", chatMessages=TURNS)

    assert backfill_chats(dry_run=True, batch=2)["chatOnly"] == 5
    assert backfill_chats(dry_run=True, batch=10)["chatOnly"] == 5


def test_already_moved_rows_do_not_stall_a_real_run() -> None:
    """The same defect on the write path.

    Rows already moved stay in the query's result set, so a page full of them
    advanced nothing and the loop exited early, leaving the rest behind.
    """
    with Session(engine) as session:
        for i in range(5):
            _write_summary(session, f"bf-resume-{i}", "Chat: hi", chatMessages=TURNS)

    first = backfill_chats(dry_run=False, batch=2)
    second = backfill_chats(dry_run=False, batch=2)

    assert first["chatOnly"] == 5
    assert second == {"chatOnly": 0, "summaryPlusChat": 0, "alreadyMoved": 0}
