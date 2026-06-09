"""Mode A operator scoping tests."""

from __future__ import annotations

import uuid

import pytest
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel
from app.services.operator import get_operator_user_id, select_operator_channels


def test_local_fallback_when_all_channels_have_stale_user_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local dev DB may have channels owned by a prior account; superuser still sees them."""
    monkeypatch.setenv("ENVIRONMENT", "local")
    from app.core.config import Settings

    monkeypatch.setattr("app.services.operator.settings", Settings())

    stale_user = uuid.uuid4()
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        assert operator_id is not None

        for ch_id in ("fallback-a", "fallback-b"):
            existing = session.get(Channel, ch_id)
            if existing:
                existing.user_id = stale_user
                existing.is_frozen = False
                session.add(existing)
            else:
                session.add(
                    Channel(id=ch_id, name=ch_id, user_id=stale_user, is_frozen=False)
                )
        session.commit()

        channels = select_operator_channels(session, operator_id=operator_id)
        ids = {ch.id for ch in channels}
        assert "fallback-a" in ids
        assert "fallback-b" in ids


def test_operator_scoping_excludes_other_users_when_operator_has_channels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "local")
    from app.core.config import Settings

    monkeypatch.setattr("app.services.operator.settings", Settings())

    other_user = uuid.uuid4()
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        assert operator_id is not None

        for ch_id, name, uid in (
            ("scope-op", "scope-op", operator_id),
            ("scope-other", "scope-other", other_user),
        ):
            existing = session.get(Channel, ch_id)
            if existing:
                existing.user_id = uid
                existing.is_frozen = False
                session.add(existing)
            else:
                session.add(Channel(id=ch_id, name=name, user_id=uid, is_frozen=False))
        session.commit()

        channels = select_operator_channels(session, operator_id=operator_id)
        ids = {ch.id for ch in channels}
        assert "scope-op" in ids
        assert "scope-other" not in ids
