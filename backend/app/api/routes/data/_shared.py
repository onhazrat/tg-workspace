"""Helpers shared by more than one `/data` family.

Only the Post filter's and the Post selection's parsing live here, and only because the posts feed and the
Discover aggregate must interpret an identical filter set identically — a
Discover report is an aggregation over exactly the Posts-tab view. Letting the
two parse separately is the drift the server-side aggregation exists to remove.

Keep this module small. It is not a dumping ground: anything used by one family
belongs in that family's module.
"""

from dataclasses import replace

from sqlalchemy import ColumnElement
from sqlmodel import Session

from app.schemas.post_filter import FilterGroup, SelectionPick, SelectionRule, to_steps
from app.schemas.posts import PostScopeRequest
from app.services.post_filters import PostFilters
from app.services.post_selection import PostScope, selection_clause
from app.services.settling_curve import tree_readings, view_reading


def tree_filters(session: Session, tree: FilterGroup | None) -> PostFilters:
    """The Post filter's tree as PostFilters, with no keyword (PTR-03).

    The tree's vocabulary is closed by its schema, so nothing is left to
    refuse here. The curve is loaded only when a bound reads an estimate.
    """
    parsed = None if tree is None else tree.to_tree()
    return PostFilters(tree=parsed, tree_readings=tree_readings(session, parsed))


def parse_post_filters(
    session: Session,
    body: PostScopeRequest,
    *,
    tree: FilterGroup | None = None,
    sort: str = "newest",
) -> PostFilters:
    """The keyword, the views order's measure and the tree as PostFilters.

    The curve an Estimated View count reads through is loaded only when a views
    order or a bound will read it (PFB-03).
    """
    return replace(
        tree_filters(session, tree),
        keyword=body.keyword,
        reading=view_reading(session, body.view_measure, sort=sort),
    )


def selected_in(
    session: Session,
    selection: list[SelectionRule | SelectionPick] | None,
    scope: PostScope,
) -> ColumnElement[bool]:
    """The Post selection a request carried as a predicate; omitted is select all."""
    return selection_clause(
        session, None if selection is None else to_steps(selection), scope
    )
