"""Request and response models for the View-as exchange (ticket 26).

Closed and exhaustive, so the generated TypeScript is a real type rather than
the `Record<string, unknown>` a `dict` return would produce.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ViewAsSessionResponse(BaseModel):
    """The short-lived session an Owner just started.

    The token is returned in the body rather than set as a cookie because this
    application's transport is a bearer header (`api/base.ts`), and a session
    that lived in a cookie would be sent by every tab in the browser — the
    Owner's other tabs included, which is the opposite of a session you can put
    down.

    Every field is **required, with no default**, for `MyBudgetUsage`'s reason:
    OpenAPI marks a defaulted field optional, and the ribbon that names the
    account being viewed cannot have a fallback. "Viewing as someone, we are not
    sure who" is worse than not shipping the ribbon at all.
    """

    model_config = ConfigDict(populate_by_name=True)

    #: The bearer token to send instead of the Owner's own. Its `sub` is the
    #: subject and its `act` is the Owner — see `security.create_view_as_token`.
    access_token: str = Field(alias="accessToken")
    session_id: uuid.UUID = Field(alias="sessionId")
    subject_user_id: uuid.UUID = Field(alias="subjectUserId")
    subject_email: str = Field(alias="subjectEmail")
    actor_user_id: uuid.UUID = Field(alias="actorUserId")
    actor_email: str = Field(alias="actorEmail")
    #: `read_only`. Ticket 27 is what adds a second value.
    mode: str
    expires_at: datetime = Field(alias="expiresAt")


class ViewAsSessionEntry(BaseModel):
    """One row of the audit trail: who, whom, when.

    The two ids are nullable and the two addresses are not, which is the table's
    design showing through on the wire: the foreign keys are `SET NULL` so a
    deleted account cannot take the record of having been viewed with it, and
    the denormalised address is what still answers afterwards.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: uuid.UUID
    actor_user_id: uuid.UUID | None = Field(alias="actorUserId")
    actor_email: str = Field(alias="actorEmail")
    subject_user_id: uuid.UUID | None = Field(alias="subjectUserId")
    subject_email: str = Field(alias="subjectEmail")
    mode: str
    created_at: datetime = Field(alias="createdAt")
    expires_at: datetime = Field(alias="expiresAt")


class ViewAsSessionsResponse(BaseModel):
    """Recent View-as sessions, newest first."""

    model_config = ConfigDict(populate_by_name=True)

    sessions: list[ViewAsSessionEntry] = Field(default_factory=list)
