"""Mode A single-operator helpers (first superuser owns all data)."""

from __future__ import annotations

import logging
import uuid

from sqlmodel import Session, col, or_, select

from app.core.config import settings
from app.models import User
from app.models_tg import Channel

logger = logging.getLogger(__name__)


def get_operator_user_id(session: Session) -> uuid.UUID | None:
    """Return the bootstrap superuser id, or None if not found."""
    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    return user.id if user else None


def select_operator_channels(
    session: Session,
    *,
    operator_id: uuid.UUID | None = None,
    unfrozen_only: bool = False,
) -> list[Channel]:
    if operator_id is None:
        operator_id = get_operator_user_id(session)
    stmt = select(Channel)
    if operator_id is not None:
        stmt = stmt.where(
            or_(Channel.user_id == operator_id, col(Channel.user_id).is_(None))
        )
    if unfrozen_only:
        stmt = stmt.where(Channel.is_frozen == False)  # noqa: E712
    channels = list(session.exec(stmt).all())

    # Local dev: legacy rows may have user_id from a prior account (pre-Sprint-2).
    # When the bootstrap superuser has zero scoped channels, fall back to all rows.
    bootstrap_id = get_operator_user_id(session)
    if (
        settings.ENVIRONMENT == "local"
        and not channels
        and operator_id is not None
        and bootstrap_id is not None
        and operator_id == bootstrap_id
    ):
        logger.info(
            "Mode A local fallback: no operator-scoped channels; using all channels"
        )
        fallback = select(Channel)
        if unfrozen_only:
            fallback = fallback.where(Channel.is_frozen == False)  # noqa: E712
        channels = list(session.exec(fallback).all())

    return channels
