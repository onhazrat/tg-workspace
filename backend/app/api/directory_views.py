"""Reading a Directory view out of a request, for every route that takes one.

The Directory routes browse with it; the Tag and Dismissal routes act on a
view's matches with it (All matching, ADR-031). It lives beside `deps.py`
rather than in a route module so no route module imports another.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy import Select
from sqlalchemy import text as sa_text
from sqlmodel import Session

from app.core.permissions import Permission
from app.schemas.directory import DirectoryTargets, DirectoryViewRequest
from app.services import directory_reads, rbac
from app.services.post_filters import TreeAtom, TreeGroup


def view_of(
    session: Session,
    user_id: uuid.UUID,
    body: DirectoryViewRequest,
    *reads: str,
    candidate: TreeAtom[directory_reads.DirectoryCond] | None = None,
) -> directory_reads.DirectoryView:
    """The view for `body`, refusing what this reader may not sort or filter by.

    `reads` are what the request sorts or measures by besides its filter. A
    `DATA_ADMIN` reader is listed every kind of entry; anyone else is answered
    422 for naming an internal column, as an unknown one would be (DPF).
    """
    tree = None if body.filter is None else body.filter.to_tree()
    internals = sees_internals(session, user_id)
    if not internals:
        named = directory_reads.internal_reads(tree, *reads)
        if candidate is not None:
            alone = TreeGroup(op="and", children=(candidate,))
            named |= directory_reads.internal_reads(alone)
        if named:
            raise HTTPException(
                status_code=422,
                detail=f"Not a column this account may read: {', '.join(sorted(named))}",
            )
    return directory_reads.resolve_view(
        session,
        user_id,
        tree=tree,
        source=body.yours.source,
        handles=body.yours.handles,
        kinds=body.reference_kinds,
        search=None if body.search is None else (body.search.text, body.search.fields),
        every_kind=internals,
    )


def targets(
    session: Session,
    user_id: uuid.UUID,
    body: DirectoryTargets,
    *,
    unfollowed: bool = False,
) -> list[str] | Select[tuple[str]]:
    """What a bulk write reaches: `body`'s handles, or every entry its view
    matches, as a statement the write reads from (All matching, ADR-031).
    `unfollowed` leaves the reader's Follows out of a view."""
    if body.view is None:
        return body.handles
    return directory_matching(session, user_id, body.view, unfollowed=unfollowed)


def directory_matching(
    session: Session,
    user_id: uuid.UUID,
    body: DirectoryViewRequest,
    *,
    unfollowed: bool = False,
) -> Select[tuple[str]]:
    """Every entry `body` matches, as a statement a write reads from."""
    # A view can match the whole Directory; past this the write fails rather
    # than holding the request open. Staging measures before a job replaces it.
    session.execute(sa_text("SET LOCAL statement_timeout = '60s'"))
    view = view_of(session, user_id, body)
    return directory_reads.matching(view, unfollowed=unfollowed)


def sees_internals(session: Session, user_id: uuid.UUID) -> bool:
    return rbac.has_permission(session, user_id, Permission.DATA_ADMIN)
