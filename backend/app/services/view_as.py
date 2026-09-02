"""The View-as session record (ticket 26).

Kind: **aggregate** (`tests/services/test_service_kinds.py`). It owns
`view_as_sessions` and is the only module that writes it.

There is very little here on purpose. A View-as session *is* its token — the
server consults nothing while one is in use, because `sub` and `act` are signed
claims and a per-request lookup would buy nothing but a query. What this table
holds is the answer to "who looked at whose account, and when", which is a
question asked long after the session has expired and by somebody who was not
there.

That is also why nothing here revokes. A revocation list would be a second
authority on whether a session is live, consulted on every request, disagreeing
with the token's own `exp` the first time a write failed — and the window it
would close is thirty minutes wide (`VIEW_AS_TOKEN_EXPIRE_MINUTES`). If a
session has to be stopped sooner, disabling the *account* stops it, which
`get_current_user` already answers with `VIEW_AS_TARGET_INACTIVE_DETAIL`.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from sqlmodel import Session, col, desc, select

from app.models import User
from app.models_view_as import ViewAsSession


def record_session(
    session: Session,
    *,
    actor: User,
    subject: User,
    expires_at: datetime,
    mode: str,
) -> ViewAsSession:
    """Write the audit row for one exchange, and return it.

    Takes the two `User` rows rather than their ids because the addresses are
    denormalised onto the record and reading them back through a second query
    would let the row disagree with itself. `actor` and `subject` are
    keyword-only for the reason `security.create_view_as_token`'s arguments
    are: they are the same type, and a transposed pair would record the Owner
    as having been viewed.

    The row is committed here rather than left to the caller, because the token
    must not exist without it — an exchange that hands back a session and fails
    to record it is precisely the thing an audit table is for.
    """
    row = ViewAsSession(
        actor_user_id=actor.id,
        actor_email=actor.email,
        subject_user_id=subject.id,
        subject_email=subject.email,
        expires_at=expires_at,
        mode=mode,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_sessions(session: Session, *, limit: int = 100) -> Sequence[ViewAsSession]:
    """The most recent sessions, newest first.

    Unscoped, and that is the point of the table: an Owner asking "who has been
    looking at accounts" needs every Owner's sessions, not their own. The route
    gates it on `VIEW_AS`, which is the permission that lets somebody start one
    — read and write are the same audience here, unlike the quota split.

    There is no filter parameter. One narrowing to a single Owner is the obvious
    thing to add and would have no caller, which in this repo is a mechanism
    that exists to be trusted rather than used.
    """
    statement = select(ViewAsSession).order_by(desc(col(ViewAsSession.created_at)))
    return session.exec(statement.limit(limit)).all()
