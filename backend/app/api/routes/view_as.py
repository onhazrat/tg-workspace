"""Looking at the application as another User, read-only (ticket 26).

An Owner reproducing a reported problem needs to see what the person reporting
it sees. The exchange below hands back a short-lived token whose `sub` is the
**target account**, which is what makes that literally true: the tenancy seam,
the follow scoping and every by-id read already answer for `sub`, so nothing
downstream needs a second identity threaded through it, and no read path can be
forgotten.

The Owner is carried alongside in the `act` claim, and `api/deps.py` is where a
session holding one is refused every write. That refusal is not here, and
deliberately so: a rule enforced by the route that starts the session covers
exactly the routes somebody remembered, which is how the ninety-first one gets
missed.

Gated on `Permission.VIEW_AS`, which only the Owner role holds — the spec's
"View as is a permission, not a role", so the read-only auditor role it keeps in
view is an `INSERT` and this file does not change.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentUser, SessionDep, require_permission
from app.core import security
from app.core.config import settings
from app.core.permissions import Permission
from app.models import User
from app.schemas.view_as import (
    ViewAsSessionEntry,
    ViewAsSessionResponse,
    ViewAsSessionsResponse,
)
from app.services import rbac
from app.services.view_as import list_sessions, record_session

router = APIRouter(prefix="/view-as", tags=["view-as"])

#: What an unusable target answers. One string for "no such account", "not an
#: account you may view" and "your own account", because the three are the same
#: answer to somebody who should not learn which: the caller holds `USERS_READ`
#: and can already list accounts, but the *reason* a peer is refused is a fact
#: about that peer's permissions, and this route has no business publishing it.
_NOT_VIEWABLE = "No account to view"


@router.post(
    "/{user_id}",
    dependencies=[Depends(require_permission(Permission.VIEW_AS))],
    response_model=ViewAsSessionResponse,
)
def start_view_as(
    session: SessionDep, current_user: CurrentUser, user_id: uuid.UUID
) -> ViewAsSessionResponse:
    """Exchange the caller's token for a read-only look at one account.

    Refused for a target that holds `VIEW_AS` themselves — the ticket's "viewing
    as another holder of the permission is refused", and the reason is that a
    peer's account is the one place the permission could be used to acquire more
    of itself. Refused for the caller's own account too: a View-as session that
    is read-only over your *own* data is a downgrade nobody asked for, and it
    would be indistinguishable in the audit trail from the real thing.

    Both refusals, and "no such account", answer with **one message**. A caller
    holding `VIEW_AS` also holds `USERS_READ` and can already list every
    account, so there is no enumeration to protect — but which accounts hold
    which permissions is a different fact, and this route is not the place to
    publish it.

    **Nesting needs no check of its own here, and adding one would be a guard
    that cannot fail.** This is a POST, and `deps.view_as_allows` does not
    allowlist it, so a View-as token is refused by `get_current_user` before the
    handler runs. `test_view_as.py` asserts that at the HTTP level rather than
    here — which is the assertion that survives ticket 27 widening what an
    elevated session may do, where an unreachable branch in this file would
    silently become the only thing standing between an audit row and a lie.
    """
    actor = current_user
    target = session.get(User, user_id)
    if target is None or not target.is_active or target.id == actor.id:
        raise HTTPException(status_code=404, detail=_NOT_VIEWABLE)
    if rbac.has_permission(session, target.id, Permission.VIEW_AS):
        raise HTTPException(status_code=404, detail=_NOT_VIEWABLE)

    expires_at = datetime.now(UTC) + timedelta(
        minutes=settings.VIEW_AS_TOKEN_EXPIRE_MINUTES
    )
    # Recorded **before** the token is minted. The row is what makes the session
    # answerable afterwards, and a token handed out by a request that then
    # failed to write its record is the one outcome an audit table cannot
    # tolerate; a record with no token is merely a session somebody abandoned.
    record = record_session(
        session,
        actor=actor,
        subject=target,
        expires_at=expires_at,
        mode=security.VIEW_AS_READ_ONLY,
    )
    token = security.create_view_as_token(
        subject_id=target.id,
        subject_email=target.email,
        actor_id=actor.id,
        actor_email=actor.email,
        expires_delta=expires_at - datetime.now(UTC),
        mode=security.VIEW_AS_READ_ONLY,
    )
    return ViewAsSessionResponse(
        accessToken=token,
        sessionId=record.id,
        subjectUserId=target.id,
        subjectEmail=target.email,
        actorUserId=actor.id,
        actorEmail=actor.email,
        mode=record.mode,
        expiresAt=expires_at,
    )


#: What an elevation refuses a target for. Separate from `_NOT_VIEWABLE`
#: because the two rules are deliberately different and a shared string would
#: hide that: *looking* at an Admin's screen to reproduce their problem is
#: legitimate, and *writing* to their account under their name is not.
#:
#: Still one message for "no such account" and "not an account you may act
#: for", for `_NOT_VIEWABLE`'s reason: which accounts hold which permissions is
#: not this route's fact to publish.
_NOT_ELEVATABLE = "No account to act for"


@router.post(
    "/{user_id}/elevate",
    dependencies=[Depends(require_permission(Permission.VIEW_AS))],
    response_model=ViewAsSessionResponse,
)
def elevate_view_as(
    session: SessionDep,
    current_user: CurrentUser,
    user_id: uuid.UUID,
    minutes: Annotated[
        int | None,
        Query(ge=1, le=settings.VIEW_AS_ELEVATED_MAX_MINUTES),
    ] = None,
) -> ViewAsSessionResponse:
    """Exchange the Owner's token for a short session that may *write* (27).

    **A second exchange, not a flag flipped on the first.** It is authorised by
    the Owner's own token exactly as `start_view_as` is, which is what makes
    self-escalation impossible without a check of its own: `get_current_user`
    refuses every POST from an `act`-bearing token, so a live session cannot
    reach this route at all, whichever mode it is in. `deps` refuses the whole
    `/view-as` family for an elevated session on top of that, and
    `test_view_as_elevation.py` asserts both — the belt is structural and the
    braces are the inventory.

    **Refused for a target holding any permission at all.** The ticket says
    "refused when the target is an Admin" and `role == "admin"` is the spelling
    `CLAUDE.md` forbids: a fourth privileged role added as a row walks straight
    past it. The seeded `user` role holds nothing and
    `tests/core/test_permissions.py` asserts the default role stays that way, so
    "holds no permission" *is* "is an ordinary User", derived rather than
    listed — and it refuses a future read-only auditor too, which it should.

    `minutes` is chosen per exchange because elevation is not one activity with
    one shape: a stuck setting is thirty seconds and walking somebody's import
    is ten minutes, and an Owner forced to re-elevate repeatedly asks for the
    maximum every time. The ceiling is validated at boot to be strictly shorter
    than the read-only session (`Settings._enforce_elevation_is_shorter_than_looking`),
    so the ticket's "shorter-lived than" holds for every value reachable here
    rather than for the default alone.
    """
    actor = current_user
    target = session.get(User, user_id)
    if target is None or not target.is_active or target.id == actor.id:
        raise HTTPException(status_code=404, detail=_NOT_ELEVATABLE)
    if rbac.permissions_for(session, target.id):
        raise HTTPException(status_code=404, detail=_NOT_ELEVATABLE)

    lifetime = timedelta(
        minutes=minutes
        if minutes is not None
        else settings.VIEW_AS_ELEVATED_DEFAULT_MINUTES
    )
    expires_at = datetime.now(UTC) + lifetime
    # Recorded before the token is minted, for `start_view_as`'s reason — and
    # the row is a *new* one rather than an update to the read-only session it
    # replaces. "Looked" and "changed" are different acts, they happened at
    # different times, and an auditor asking "when did an Owner gain write
    # access to this account" needs a row whose `created_at` answers it.
    record = record_session(
        session,
        actor=actor,
        subject=target,
        expires_at=expires_at,
        mode=security.VIEW_AS_ELEVATED,
    )
    token = security.create_view_as_token(
        subject_id=target.id,
        subject_email=target.email,
        actor_id=actor.id,
        actor_email=actor.email,
        expires_delta=expires_at - datetime.now(UTC),
        mode=security.VIEW_AS_ELEVATED,
    )
    return ViewAsSessionResponse(
        accessToken=token,
        sessionId=record.id,
        subjectUserId=target.id,
        subjectEmail=target.email,
        actorUserId=actor.id,
        actorEmail=actor.email,
        mode=record.mode,
        expiresAt=expires_at,
    )


@router.get(
    "/sessions",
    dependencies=[Depends(require_permission(Permission.VIEW_AS))],
    response_model=ViewAsSessionsResponse,
)
def read_view_as_sessions(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=500)] = 100
) -> ViewAsSessionsResponse:
    """Recent View-as sessions across every Owner, newest first.

    Every Owner's, not the caller's own. "There is an answer to who looked at
    what" is the ticket's checkbox, and an answer that only covers the person
    asking is not one.
    """
    return ViewAsSessionsResponse(
        sessions=[
            ViewAsSessionEntry(
                id=row.id,
                actorUserId=row.actor_user_id,
                actorEmail=row.actor_email,
                subjectUserId=row.subject_user_id,
                subjectEmail=row.subject_email,
                mode=row.mode,
                createdAt=row.created_at,
                expiresAt=row.expires_at,
            )
            for row in list_sessions(session, limit=limit)
        ]
    )
