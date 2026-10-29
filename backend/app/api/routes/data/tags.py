"""The Account's Tags as a whole, for the Directory (DFP-04, ADR-029).

A Tag belongs to the Account and sits on any handle, followed or not, so these
routes take handles rather than Channel ids; the Channels tab keeps tagging
through `PATCH /channels/bulk-tags`. Every write reaches only the caller's own
rows, because every statement in `services/tags.py` is keyed by the caller.

The handler function names here are settled and never renamed: the operation id
derives from the function name.
"""

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.api.directory_views import targets
from app.schemas.tags import (
    TagChangeResponse,
    TagDeleteRequest,
    TagHandlesRequest,
    TagHandlesResponse,
    TagOrderRequest,
    TagOrderResponse,
    TagRenameRequest,
    TagResponse,
    TagUseRequest,
)
from app.services import tags
from app.services.channel_tags import reject_reserved_virtual_group_tags
from app.services.sync_meta import touch_sync

router = APIRouter()

#: 404 for a rename or delete naming a Tag the caller does not have.
TAG_NOT_FOUND = "Tag not found"


def _commit(session: Session) -> None:
    # A Tag on a followed Channel shows on the Channels tab, so its etag moves
    # in the same transaction (`touch_sync`'s docstring).
    touch_sync(session, "channels", commit=False)
    session.commit()


@router.get("/tags")
def list_tags(session: SessionDep, current_user: CurrentUser) -> list[TagResponse]:
    """The caller's Tags with how many Channels carry each, by name."""
    return [
        TagResponse(name=name, channels=count)
        for name, count in tags.tag_counts(session, user_id=current_user.id)
    ]


@router.get("/tags/channels")
def list_tag_channels(
    session: SessionDep,
    current_user: CurrentUser,
    name: str = Query(min_length=1),
) -> TagHandlesResponse:
    """The handles carrying one of the caller's Tags; a `group:` name included."""
    return TagHandlesResponse(
        name=name,
        handles=tags.handles_for_tag(session, user_id=current_user.id, name=name),
    )


@router.post("/tags/channels")
def add_tag_channels(
    body: TagHandlesRequest, session: SessionDep, current_user: CurrentUser
) -> TagChangeResponse:
    """Put a Tag on handles, followed or not; a new name makes a new Tag."""
    reject_reserved_virtual_group_tags([body.name])
    changed = tags.assign_tag(
        session,
        user_id=current_user.id,
        name=body.name,
        handles=targets(session, current_user.id, body),
    )
    _commit(session)
    return TagChangeResponse(changed=changed)


@router.delete("/tags/channels")
def remove_tag_channels(
    body: TagHandlesRequest, session: SessionDep, current_user: CurrentUser
) -> TagChangeResponse:
    """Take a Tag off handles. A body rather than a path, matching the POST."""
    changed = tags.unassign_tag(
        session,
        user_id=current_user.id,
        name=body.name,
        handles=targets(session, current_user.id, body),
    )
    _commit(session)
    return TagChangeResponse(changed=changed)


@router.patch("/tags")
def rename_tag(
    body: TagRenameRequest, session: SessionDep, current_user: CurrentUser
) -> TagResponse:
    """Rename a Tag on every Channel; onto a name the caller has, the two merge."""
    reject_reserved_virtual_group_tags([body.to])
    renamed = tags.rename_tag(
        session, user_id=current_user.id, name=body.name, to=body.to
    )
    if renamed is None:
        raise HTTPException(status_code=404, detail=TAG_NOT_FOUND)
    _commit(session)
    name, count = renamed
    return TagResponse(name=name, channels=count)


# TGU-02, ADR-042: Tag uses order each tab's Tag lists.
@router.post("/tags/uses")
def record_tag_use(
    body: TagUseRequest, session: SessionDep, current_user: CurrentUser
) -> TagChangeResponse:
    """Record one use of a Tag on a tab; nothing for a Tag the caller lacks."""
    changed = tags.record_use(
        session, user_id=current_user.id, tab=body.tab, name=body.name
    )
    session.commit()
    return TagChangeResponse(changed=changed)


@router.post("/tags/order")
def read_tag_order(
    body: TagOrderRequest, session: SessionDep, current_user: CurrentUser
) -> list[TagOrderResponse]:
    """Each of the caller's Tags by name: its channels in the scope, how many
    of those are selected, and its Tag use score and last use on the tab."""
    return [
        TagOrderResponse(
            name=row.name,
            channels=row.channels,
            selected=row.selected,
            score=row.score,
            lastUsedAt=row.last_used_at,
        )
        for row in tags.tag_order(
            session,
            user_id=current_user.id,
            tab=body.tab,
            scope=body.scope,
            selected=body.selected,
        )
    ]


@router.delete("/tags")
def delete_tag(
    body: TagDeleteRequest, session: SessionDep, current_user: CurrentUser
) -> TagChangeResponse:
    """Take a Tag off every Channel."""
    changed = tags.delete_tag(session, user_id=current_user.id, name=body.name)
    if changed is None:
        raise HTTPException(status_code=404, detail=TAG_NOT_FOUND)
    _commit(session)
    return TagChangeResponse(changed=changed)
