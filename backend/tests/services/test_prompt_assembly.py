"""Server-side prompt posts assembly + its over-budget guardrails.

The budget refuses an oversized selection with a clear 413 rather than silently
dropping the user's posts.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Post
from app.prompts.posts import format_posts_for_prompt
from app.services import prompt_assembly
from app.services.prompt_assembly import PromptScope, assemble_posts_text


def _add(session: Session, channel: str, post_id: int, **kw: Any) -> None:
    session.add(
        Post(
            channel_name=channel,
            post_id=post_id,
            text=kw.pop("text", f"{channel}-{post_id}"),
            timestamp=kw.pop("timestamp", 1000 + post_id),
            **kw,
        )
    )


def test_assembles_scope_matching_the_feed_order() -> None:
    with Session(engine) as session:
        _add(session, "a", 1, timestamp=100, text="oldest")
        _add(session, "a", 2, timestamp=300, text="newest")
        _add(session, "a", 3, timestamp=200, text="middle")
        session.commit()

        text = assemble_posts_text(session, PromptScope(channels=["a"]))

        # Newest-first (time sort), formatted by the shared helper.
        assert text == format_posts_for_prompt(
            [
                {"channelName": "a", "id": 2, "date": "", "text": "newest"},
                {"channelName": "a", "id": 3, "date": "", "text": "middle"},
                {"channelName": "a", "id": 1, "date": "", "text": "oldest"},
            ]
        )


def test_empty_scope_returns_empty_string() -> None:
    with Session(engine) as session:
        assert assemble_posts_text(session, PromptScope(channels=["nope"])) == ""


def test_rejects_too_many_posts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(prompt_assembly, "MAX_PROMPT_POSTS", 2)
    with Session(engine) as session:
        for i in range(3):
            _add(session, "a", i)
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            assemble_posts_text(session, PromptScope(channels=["a"]))
        assert excinfo.value.status_code == 413
        assert "3" in str(excinfo.value.detail)


def test_rejects_over_token_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(prompt_assembly, "MAX_PROMPT_TOKENS", 1)
    with Session(engine) as session:
        _add(session, "a", 1, text="a reasonably long body that exceeds one token")
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            assemble_posts_text(session, PromptScope(channels=["a"]))
        assert excinfo.value.status_code == 413
        assert "token" in str(excinfo.value.detail).lower()
