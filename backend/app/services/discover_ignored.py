"""Dismissed Discover candidates (IDEA-011 D8).

Like `isFollowed`, `isIgnored` is *not* stored inside a saved report — it is
resolved against this table on every read. A report records what was referenced
at a point in time; whether the operator has since decided against a candidate
is current state, not history. Dismissing therefore updates every report at
once rather than only the one on screen.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, col, select

from app.models_tg import DiscoverIgnoredChannel, utc_now


def normalize_handle(name: str) -> str:
    """Mirrors `discover.normalize_handle` — the key must match candidate names."""
    return name.lstrip("@").strip().lower()


def ignored_handles(session: Session) -> set[str]:
    rows = session.exec(select(DiscoverIgnoredChannel.handle)).all()
    return {str(handle) for handle in rows}


def list_ignored(session: Session) -> list[dict[str, Any]]:
    statement = select(DiscoverIgnoredChannel).order_by(
        col(DiscoverIgnoredChannel.created_at).desc()
    )
    return [
        {
            "handle": row.handle,
            "reason": row.reason,
            "createdAt": int(row.created_at.timestamp() * 1000),
        }
        for row in session.exec(statement).all()
    ]


def ignore_channels(
    session: Session,
    handles: list[str],
    *,
    reason: str | None = None,
    user_id: uuid.UUID | None = None,
) -> list[str]:
    """Dismiss handles. Idempotent — re-dismissing an entry is not an error."""
    added: list[str] = []
    existing = ignored_handles(session)
    for raw in handles:
        handle = normalize_handle(raw)
        if not handle or handle in existing:
            continue
        session.add(
            DiscoverIgnoredChannel(
                handle=handle,
                user_id=user_id,
                reason=reason,
                created_at=utc_now(),
            )
        )
        existing.add(handle)
        added.append(handle)
    session.commit()
    return added


def unignore_channels(session: Session, handles: list[str]) -> list[str]:
    """Undo a dismissal. Unknown handles are ignored rather than 404ing.

    Dismissal is a toggle in the UI, so removing something already absent is a
    no-op, not a failure.
    """
    removed: list[str] = []
    for raw in handles:
        handle = normalize_handle(raw)
        row = session.get(DiscoverIgnoredChannel, handle)
        if row is None:
            continue
        session.delete(row)
        removed.append(handle)
    session.commit()
    return removed
