"""Mode A operator scoping tests."""

from __future__ import annotations

import uuid

import pytest
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.operator import get_operator_user_id, select_operator_channels


def test_local_fallback_when_all_channels_have_stale_user_id(
    monkeypatch: pytest.MonkeyPatch,
    tg_test_channel,
) -> None:
    """Local dev DB may have channels owned by a prior account; superuser still sees them."""
    monkeypatch.setenv("ENVIRONMENT", "local")
    from app.core.config import Settings

    monkeypatch.setattr("app.services.operator.settings", Settings())

    stale_user = uuid.uuid4()
    for ch_id in ("fallback-a", "fallback-b"):
        tg_test_channel(ch_id, name=ch_id, user_id=stale_user, is_frozen=False)

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        assert operator_id is not None
        channels = select_operator_channels(session, operator_id=operator_id)
        ids = {ch.id for ch in channels}
        assert "fallback-a" in ids
        assert "fallback-b" in ids


def test_operator_scoping_excludes_other_users_when_operator_has_channels(
    monkeypatch: pytest.MonkeyPatch,
    tg_test_channel,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "local")
    from app.core.config import Settings

    monkeypatch.setattr("app.services.operator.settings", Settings())

    other_user = uuid.uuid4()
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        assert operator_id is not None

    tg_test_channel("scope-op", name="scope-op", user_id=operator_id, is_frozen=False)
    tg_test_channel(
        "scope-other", name="scope-other", user_id=other_user, is_frozen=False
    )

    with Session(engine) as session:
        channels = select_operator_channels(session, operator_id=operator_id)
        ids = {ch.id for ch in channels}
        assert "scope-op" in ids
        assert "scope-other" not in ids
