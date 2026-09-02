"""The record of one View-as session (ticket 26).

A fourth model module, and the rule is the one `models_rbac.py` was created
under: the split is by *what the models are*, not by how many files there are.
`models.py` is the template's auth models, `models_tg.py` is the TG domain,
`models_rbac.py` is roles and their assignments. A record of an administrative
act — an Owner looked at an account, at a time — is none of the three, and
filing it under the nearest one would have made that module's stated purpose
false.

**Neither foreign key cascades, and that is the whole design of the table.**
Every per-User table in this schema takes `ondelete="CASCADE"` from `user.id`,
because deleting an account means deleting what it owns. An audit row is not
owned by either account it names, and the case a reader most wants an answer for
is precisely the deleted one — ticket 26's last checkbox is about a target
vanishing mid-session. So both keys are `SET NULL` and both addresses are
denormalised at creation: after either account is gone the row still answers who
looked at whom, and when.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


def _now_utc() -> datetime:
    return datetime.now(UTC)


class ViewAsSession(SQLModel, table=True):
    """One exchange of an Owner's token for a read-only look at an account.

    Written once, at the exchange, and never updated. There is no `ended_at`:
    the session is a JWT and nothing on the server is consulted while it is in
    use, so an end time would be a field the browser reports and the server
    cannot check. `expires_at` is the honest bound, and it is the same number
    the token carries.
    """

    __tablename__ = "view_as_sessions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    #: The Owner who started it. Nullable only because the key is `SET NULL`;
    #: `actor_email` is what survives them.
    actor_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL", index=True
    )
    actor_email: str = Field(max_length=255)

    #: The account being looked at, and the address that outlives its deletion.
    subject_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL", index=True
    )
    subject_email: str = Field(max_length=255)

    #: `read_only` today. Ticket 27 adds elevation, and writes a second value
    #: here rather than a second table — the question "what was this session
    #: allowed to do" is one column of one record, and splitting it would give
    #: an auditor two places to look.
    mode: str = Field(default="read_only", max_length=32)

    created_at: datetime = Field(
        default_factory=_now_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
        index=True,
    )
    expires_at: datetime = Field(
        sa_type=DateTime(timezone=True),  # type: ignore
    )
