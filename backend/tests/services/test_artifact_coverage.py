"""Which Posts an Artifact covers, read back for its prompt (ADR-038).

The Artifact coverage module's interface: `freeze` records the Posts a
submission's Post selection reached, `covered_posts` reads them back, and
`posts_block` builds the prompt's block from them. Replaces the prompt-assembly
tests, which re-applied the Selection rules to today's corpus.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import Post
from app.prompts.posts import format_posts_for_prompt, format_posts_for_tag_prompt
from app.schemas.scope import FrozenScope, ScopeSubmission
from app.services import artifact_coverage
from tests.utils.tenancy import ANY_READER, follow_channels

MINUTE = 60_000
NOW = 1_000 * MINUTE


def _post(session: Session, channel: str, post_id: int, **kw: Any) -> None:
    session.add(
        Post(
            channel_name=channel,
            post_id=post_id,
            text=kw.pop("text", f"{channel}-{post_id}"),
            timestamp=kw.pop("timestamp", (100 + post_id) * MINUTE),
            **kw,
        )
    )


def _freeze(session: Session, channels: list[str], **scope: Any) -> FrozenScope:
    return artifact_coverage.freeze(
        session,
        ScopeSubmission.model_validate(
            {
                "channels": channels,
                "window": {"mode": "fixed", "start": 0, "end": 500 * MINUTE},
                **scope,
            }
        ),
        user_id=ANY_READER,
        now_ms=NOW,
    )


def _ids(session: Session, scope: FrozenScope) -> list[tuple[str, int]]:
    coverage = artifact_coverage.covered_posts(session, scope, user_id=ANY_READER)
    return [(p["channelName"], p["id"]) for p in coverage.posts]


def _window(channels: list[str], **extra: Any) -> FrozenScope:
    """A Scope with no Posts on record: a regeneration, or one made before PTR-05."""
    return FrozenScope.model_validate(
        {"channels": channels, "start": 0, "end": 500 * MINUTE, **extra}
    )


def _refs(*pairs: tuple[str, int]) -> FrozenScope:
    return _window(
        sorted({c for c, _ in pairs}),
        posts=[{"channelName": c, "postId": p} for c, p in pairs],
    )


def test_a_post_synced_into_the_window_after_the_freeze_is_not_read() -> None:
    with Session(engine) as session:
        follow_channels(session, "a", user_id=ANY_READER)
        _post(session, "a", 1)
        _post(session, "a", 2)
        session.commit()
        frozen = _freeze(session, ["a"])
        _post(session, "a", 3)
        session.commit()

        assert _ids(session, frozen) == [("a", 2), ("a", 1)]


def test_a_reordered_views_ranking_keeps_the_frozen_posts() -> None:
    top_one = {
        "kind": "rule",
        "select": True,
        "filter": {"sort": "most_views", "viewMeasure": "views", "maxPerChannel": 1},
    }
    with Session(engine) as session:
        follow_channels(session, "a", user_id=ANY_READER)
        _post(session, "a", 1, views_count=900)
        _post(session, "a", 2, views_count=10)
        session.commit()
        frozen = _freeze(session, ["a"], selection=[top_one])
        overtaker = session.exec(select(Post).where(col(Post.post_id) == 2)).one()
        overtaker.views_count = 5_000
        session.add(overtaker)
        session.commit()

        assert _ids(session, frozen) == [("a", 1)]


def test_a_scope_with_no_posts_on_record_covers_its_window() -> None:
    with Session(engine) as session:
        follow_channels(session, "a", "b", user_id=ANY_READER)
        _post(session, "a", 1)
        _post(session, "b", 2)
        _post(session, "a", 3, timestamp=600 * MINUTE)
        _post(session, "c", 4)
        session.commit()

        assert _ids(session, _window(["a", "b"])) == [("b", 2), ("a", 1)]


def test_the_recorded_order_is_kept() -> None:
    with Session(engine) as session:
        follow_channels(session, "a", "b", user_id=ANY_READER)
        for channel, post_id in (("a", 1), ("a", 2), ("b", 3)):
            _post(session, channel, post_id)
        session.commit()

        scope = _refs(("a", 1), ("b", 3), ("a", 2))

        assert _ids(session, scope) == [("a", 1), ("b", 3), ("a", 2)]


def test_a_reclaimed_post_and_an_unfollowed_channels_post_are_missing() -> None:
    with Session(engine) as session:
        follow_channels(session, "a", user_id=ANY_READER)
        _post(session, "a", 1)
        _post(session, "gone", 2)
        session.commit()

        coverage = artifact_coverage.covered_posts(
            session, _refs(("a", 1), ("a", 9), ("gone", 2)), user_id=ANY_READER
        )

        assert [(p["channelName"], p["id"]) for p in coverage.posts] == [("a", 1)]
        assert coverage.missing == 2


def test_the_block_is_the_shared_formatter_in_either_layout() -> None:
    with Session(engine) as session:
        follow_channels(session, "a", user_id=ANY_READER)
        _post(session, "a", 1, media={"kinds": ["photo"]})
        _post(session, "a", 2)
        session.commit()
        scope = _refs(("a", 2), ("a", 1), ("a", 7))

        flat, coverage = artifact_coverage.posts_block(
            session, scope, user_id=ANY_READER, layout="flat"
        )
        tag, _ = artifact_coverage.posts_block(
            session, scope, user_id=ANY_READER, layout="tag"
        )

        assert flat == format_posts_for_prompt(coverage.posts)
        assert "Media: photo" in flat
        assert tag == format_posts_for_tag_prompt(coverage.posts, ["a"])
        assert coverage.missing == 1


def test_more_posts_than_one_prompt_takes_is_a_413(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(artifact_coverage, "MAX_PROMPT_POSTS", 2)
    with Session(engine) as session:
        follow_channels(session, "a", user_id=ANY_READER)
        for i in range(3):
            _post(session, "a", i)
        session.commit()

        for scope in (_window(["a"]), _refs(("a", 0), ("a", 1), ("a", 2))):
            with pytest.raises(HTTPException) as excinfo:
                artifact_coverage.posts_block(session, scope, user_id=ANY_READER)
            assert excinfo.value.status_code == 413
            assert "3" in str(excinfo.value.detail)


def test_a_block_over_the_token_budget_is_a_413(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(artifact_coverage, "MAX_PROMPT_TOKENS", 1)
    with Session(engine) as session:
        follow_channels(session, "a", user_id=ANY_READER)
        _post(session, "a", 1, text="a reasonably long body that exceeds one token")
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            artifact_coverage.posts_block(session, _window(["a"]), user_id=ANY_READER)
        assert excinfo.value.status_code == 413
        assert "token" in str(excinfo.value.detail).lower()
