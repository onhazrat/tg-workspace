"""Dismissed Discover candidates (IDEA-011 D8).

Like `isFollowed`, `isIgnored` is *not* stored inside a saved report — it is
resolved against this table on every read. A report records what was referenced
at a point in time; whether the caller has since decided against a candidate
is current state, not history. Dismissing therefore updates every report at
once rather than only the one on screen.

## A dismissal is one account's judgement (ticket 30)

`user_id` is half the primary key, so every function here takes one and none of
them has a default. Two accounts hold independent verdicts on the same handle,
and neither can see or undo the other's.

**The owner filter here is not `scoped_select`, and that is deliberate.** The
seam's filter is gated on `tenancy_enforced()` because it answers a *visibility*
question — which of these rows may you see — and while the flag is off every
adopting batch has to stay byte-identical. The owner is part of this table's
key, so filtering on it answers an *identity* question instead: which row is
yours. A flag cannot gate identity. Gated off, both accounts would resolve to
one row again and the composite key would be decoration:

* `ignore_channels` skips a handle that already has a row. Read globally, A's
  dismissal makes B's write a no-op, and a scoped read then tells B the handle
  is not dismissed — so B can never dismiss it and the button silently does
  nothing. That is a functional regression, not a visibility one, which is why
  the ticket refuses the read-only half-fix.
* `unignore_channels` resolved a row by handle alone, so B undoing a dismissal
  deleted A's row and reported success for something that was never theirs.

`test_discover_dismissals_are_per_account.py` runs every guard under both flag
states for this reason.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, col, select

from app.models_tg import DiscoverIgnoredChannel, utc_now


def normalize_handle(name: str) -> str:
    """Mirrors `discover.normalize_handle` — the key must match candidate names."""
    return name.lstrip("@").strip().lower()


def ignored_handles(session: Session, *, user_id: uuid.UUID) -> set[str]:
    """The handles `user_id` has dismissed. Never anybody else's."""
    rows = session.exec(
        select(DiscoverIgnoredChannel.handle).where(
            col(DiscoverIgnoredChannel.user_id) == user_id
        )
    ).all()
    return {str(handle) for handle in rows}


def list_ignored(session: Session, *, user_id: uuid.UUID) -> list[dict[str, Any]]:
    statement = (
        select(DiscoverIgnoredChannel)
        .where(col(DiscoverIgnoredChannel.user_id) == user_id)
        .order_by(col(DiscoverIgnoredChannel.created_at).desc())
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
    user_id: uuid.UUID,
) -> list[str]:
    """Dismiss handles for one account. Idempotent for that account only.

    The `existing` set is the caller's own rows, which is the whole ticket: read
    globally, a handle another account had already dismissed would be skipped
    here and this would return `[]` having written nothing.
    """
    added: list[str] = []
    existing = ignored_handles(session, user_id=user_id)
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


def unignore_channels(
    session: Session, handles: list[str], *, user_id: uuid.UUID
) -> list[str]:
    """Undo one account's dismissal. Unknown handles are ignored, not 404s.

    Dismissal is a toggle in the UI, so removing something already absent is a
    no-op, not a failure — and a handle only *another* account dismissed is
    absent as far as this caller is concerned.

    The row is resolved by the full composite key, and **nothing but the test
    enforces that**. The ticket predicted `session.get(model, handle)` would
    stop compiling once the key gained its second half; it does not. Reverting
    this line passes `mypy --strict` and `ty check` and fails only at runtime,
    as `InvalidRequestError: Incorrect number of values in identifier`, which
    reaches the caller as a 500 on `DELETE /data/discover/ignored`.
    `test_undoing_never_reaches_another_accounts_dismissal` is the real guard.
    """
    removed: list[str] = []
    for raw in handles:
        handle = normalize_handle(raw)
        if not handle:
            continue
        row = session.get(DiscoverIgnoredChannel, (handle, user_id))
        if row is None:
            continue
        session.delete(row)
        removed.append(handle)
    session.commit()
    return removed
