"""DFP-03's migration carries every Follow's Tags into `tg_tags` (ADR-029).

These run the migration's own statement rather than a copy of it, as
`test_directory_seed.py` and `test_owner_backfill.py` do: a copy is a test that
passes while the thing that runs on deploy does something else. The column it
reads is gone at head, so `legacy_follow_tags_column` puts it back.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import types
from collections.abc import Iterator
from typing import Any

import pytest
import sqlalchemy as sa
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import Channel
from app.services.tags import tags_by_handle
from tests.utils.user import create_random_user

MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app"
    / "alembic"
    / "versions"
    / "db2bb3daf99f_tags_belong_to_the_account_dfp_03.py"
)


def load_migration() -> types.ModuleType:
    """Import the revision file directly — `versions/` is not a package."""
    spec = importlib.util.spec_from_file_location("tag_move", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def session(legacy_follow_tags_column: None) -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def users(session: Session) -> Iterator[tuple[User, User]]:
    created = (create_random_user(session), create_random_user(session))
    yield created
    session.exec(delete(User).where(col(User.id).in_([u.id for u in created])))
    session.commit()


def _follow(session: Session, user: User, channel_id: str, tags: Any) -> None:
    session.execute(
        sa.text(
            "INSERT INTO tg_channel_follows "
            "(user_id, channel_id, tags, created_at, updated_at) "
            "VALUES (:user_id, :channel_id, CAST(:tags AS json), now(), now())"
        ),
        {"user_id": user.id, "channel_id": channel_id, "tags": json.dumps(tags)},
    )


def _move(session: Session) -> None:
    session.execute(sa.text(load_migration().MOVE_TAGS_SQL))
    session.commit()


def test_every_follows_tags_move_with_source_and_time(
    session: Session, users: tuple[User, User]
) -> None:
    alice, bob = users
    session.add(Channel(id="Alpha_News", name="Alpha_News"))
    session.add(Channel(id="beta", name="beta"))
    session.flush()
    _follow(
        session,
        alice,
        "Alpha_News",
        [
            {"name": " News ", "source": "ai", "assignedAt": 5},
            "Sports",
            {"name": "Tech", "assignedAt": -3, "source": "bogus"},
        ],
    )
    _follow(session, bob, "beta", [{"name": "News", "source": "manual"}])
    session.commit()

    _move(session)

    assert tags_by_handle(session, user_id=alice.id) == {
        "alpha_news": [
            {"name": "Sports", "source": "manual", "assignedAt": 0},
            {"name": "Tech", "source": "manual", "assignedAt": 0},
            {"name": "News", "source": "ai", "assignedAt": 5},
        ]
    }
    assert tags_by_handle(session, user_id=bob.id) == {
        "beta": [{"name": "News", "source": "manual", "assignedAt": 0}]
    }


def test_case_duplicates_merge_keeping_the_name_first_written(
    session: Session, users: tuple[User, User]
) -> None:
    """Two Channel ids differing by case are one handle; one Follow can repeat."""
    alice, _bob = users
    session.add(Channel(id="Gamma", name="Gamma"))
    session.add(Channel(id="gamma", name="gamma"))
    session.flush()
    _follow(
        session,
        alice,
        "Gamma",
        [{"name": "news", "source": "manual", "assignedAt": 9}, "Sports", "SPORTS"],
    )
    _follow(
        session, alice, "gamma", [{"name": "News", "source": "ai", "assignedAt": 4}]
    )
    session.commit()

    _move(session)

    assert tags_by_handle(session, user_id=alice.id) == {
        "gamma": [
            {"name": "Sports", "source": "manual", "assignedAt": 0},
            {"name": "News", "source": "ai", "assignedAt": 4},
        ]
    }


def test_blank_reserved_and_malformed_entries_are_not_carried(
    session: Session, users: tuple[User, User]
) -> None:
    alice, bob = users
    session.add(Channel(id="delta", name="delta"))
    session.flush()
    _follow(
        session,
        alice,
        "delta",
        ["  ", {"name": "group:Daily"}, {"source": "ai"}, 7, {"name": 3}, "Kept"],
    )
    _follow(session, bob, "delta", {"not": "a list"})
    session.commit()

    _move(session)

    assert tags_by_handle(session, user_id=alice.id) == {
        "delta": [{"name": "Kept", "source": "manual", "assignedAt": 0}]
    }
    assert tags_by_handle(session, user_id=bob.id) == {}
