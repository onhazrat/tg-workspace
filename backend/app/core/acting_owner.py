"""Who is writing, when that is not the account the row belongs to (ticket 27).

An elevated View-as session writes rows owned by the *target* — `sub` is the
target, so `current_user` is the target, and every aggregate stamps `user_id`
with it exactly as it would for the person themselves. That is the design of
ticket 26 working correctly, and it is also the lie ticket 27 exists to stop:
the artifact says the User made it, and nothing anywhere says an Owner did.

So the acting Owner has to reach four aggregates that take a `Session` and no
`Request`. This module is how.

## Why `session.info` and not a `contextvar`

A context variable set by `get_current_user` is the obvious answer and it does
not work — silently, which is the part that matters. `get_current_user` is a
`def`, FastAPI solves a sync dependency through `run_in_threadpool`, and anyio
copies the context into the worker thread; the assignment lands on the copy and
the endpoint never sees it. Every write would be attributed to nobody, and the
only way to make a guard pass would be to write the guard wrong.

`session.info` is SQLAlchemy's per-`Session` dict for precisely this, and it is
the better fit regardless: attribution follows the **unit of work** rather than
the thread that happens to be running it. `get_current_user` holds both the
token and the `SessionDep`, so the one gate that already decides *who this
request is* is the one place that answers *and on whose behalf*.

A background job — the scheduler's auto-summary, a retention sweep, the sync
worker — opens its own `Session`, binds nothing, and stamps `NULL`. That is not
a special case anybody wrote; it is what "nobody elevated anything" looks like.

## What the stamp means

**The last write to this row was made by this Owner on the User's behalf.**
`stamp` is called on every write, not only on creation, so an ordinary session
editing the row afterwards clears it back to `NULL` — the row is the User's
again, and a stamp that survived would claim an Owner touched something they
did not.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from sqlmodel import Session

#: The key `session.info` is filed under. Private to this module, because two
#: spellings of a key are two answers to the same question — the failure the
#: tenancy flag's single-reader rule exists to prevent, one layer down — and
#: nothing outside this module has any reason to name it.
_KEY = "acting_owner"


@dataclass(frozen=True)
class ActingOwner:
    """The Owner behind an elevated session, as the token names them.

    Both fields come off signed claims rather than from a lookup: the address is
    already in the token so the ribbon can render without a request, and reading
    it back through a query would let the stamp disagree with the audit row that
    was written at the same moment from the same claims.
    """

    user_id: uuid.UUID
    email: str


class _Attributable(Protocol):
    """A row that carries the stamp. All four artifact tables satisfy it."""

    acted_by_user_id: uuid.UUID | None
    acted_by_email: str | None


def bind(session: Session, owner: ActingOwner | None) -> None:
    """Declare who is acting for the rest of this `Session`'s life.

    Called from `api/deps.get_current_user` and nowhere else. `None` clears,
    which is not decoration: `SessionDep` is per-request, but a test or a script
    may reuse one, and a binding that could only be set would make the *absence*
    of an acting Owner unrepresentable after the first elevated request.
    """
    info: dict[Any, Any] = session.info
    if owner is None:
        info.pop(_KEY, None)
    else:
        info[_KEY] = owner


def current(session: Session) -> ActingOwner | None:
    """The Owner acting through this `Session`, or `None` for an ordinary one."""
    value = session.info.get(_KEY)
    return value if isinstance(value, ActingOwner) else None


def stamp(session: Session, row: _Attributable) -> None:
    """Record who wrote this row, on every write.

    Assigns unconditionally — including the `None` that clears a previous stamp
    — because the column answers "who made the *last* write", and a `stamp` that
    only ever wrote a value would leave an Owner's name on a row the User has
    since edited themselves.
    """
    owner = current(session)
    row.acted_by_user_id = owner.user_id if owner else None
    row.acted_by_email = owner.email if owner else None


__all__ = ["ActingOwner", "bind", "current", "stamp"]
