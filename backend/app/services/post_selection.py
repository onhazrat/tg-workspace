"""The Post selection: which Posts an Action covers (PTR-05, ADR-026).

An ordered list of steps. A **Selection rule** selects or deselects every Post
its Post filter matches in the current window and Channels, so it reaches new
Posts when the window moves. A **Pick** selects or deselects one Post, in any
window. The last step to reach a Post decides it, and a Post no step reaches is
not selected. The default is one rule, select all, so an Account that never
touches it covers every Post in the window, as before.

The browser never evaluates it: every read the Posts tab makes asks for the
`selected` flag, and every Action resolves the selection here.

`selection_clause` is one predicate over `Post`, for whatever read encloses it:
a `CASE` over the steps from last to first, which is "last step wins" spelled
in SQL. Picks go in as `VALUES` lists, which Postgres hashes once per query,
so 5,000 of them cost a probe per row rather than a scan.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import (
    ColumnElement,
    Integer,
    String,
    and_,
    case,
    column,
    false,
    func,
    true,
    tuple_,
    values,
)
from sqlmodel import Session, col, select

from app.models_tg import Post
from app.schemas.post_filter import to_steps
from app.schemas.scope import FrozenScope, ScopeSubmission
from app.services.analysis_window import freeze_scope
from app.services.follows import visible_channel_names
from app.services.post_filters import (
    SELECT_ALL,
    FeedSort,
    Pick,
    PostFilters,
    Rule,
    Step,
    TypeCond,
    ViewMeasure,
    analysis_window_clauses,
    apply_analysis_window,
    post_filter_clauses,
    tree_conds,
)
from app.services.posts import channel_order, feed_order_by, random_cap_order
from app.services.settling_curve import tree_readings, view_reading
from app.services.tenancy import scoped_select


@dataclass(frozen=True)
class PostScope:
    """The Channels and the window a rule is applied again over."""

    user_id: uuid.UUID
    channel_names: list[str] | None = None
    start_date: int | None = None
    end_date: int | None = None

    def clauses(self) -> list[ColumnElement[bool]]:
        clauses = analysis_window_clauses(self.start_date, self.end_date)
        if self.channel_names:
            clauses.append(col(Post.channel_name).in_(self.channel_names))
        return clauses


def _compressed(steps: Sequence[Step]) -> list[Rule | tuple[bool, list[Pick]]]:
    """The steps with each Post's earlier Picks dropped and the rest grouped.

    A Pick reaches only its Post, so a later Pick of the same Post overrides
    it wherever it sits. What is left between two rules reaches disjoint Posts
    and can go in two lists, one per direction, in either order.
    """
    last = {
        (s.channel_name, s.post_id): i
        for i, s in enumerate(steps)
        if isinstance(s, Pick)
    }
    out: list[Rule | tuple[bool, list[Pick]]] = []
    run: dict[bool, list[Pick]] = {True: [], False: []}

    def flush() -> None:
        out.extend((direction, picks) for direction, picks in run.items() if picks)
        run[True], run[False] = [], []

    for i, step in enumerate(steps):
        if isinstance(step, Rule):
            flush()
            out.append(step)
        elif last[(step.channel_name, step.post_id)] == i:
            run[step.select].append(step)
    flush()
    return out


def _picked(picks: list[Pick]) -> ColumnElement[bool]:
    listed = values(
        column("channel_name", String), column("post_id", Integer), name="picks"
    ).data([(p.channel_name, p.post_id) for p in picks])
    return tuple_(col(Post.channel_name), col(Post.post_id)).in_(
        select(listed.c.channel_name, listed.c.post_id)
    )


def _reached(
    session: Session, rule: Rule, scope: PostScope, followed: frozenset[str] | None
) -> ColumnElement[bool]:
    """The Posts `rule` reaches: its filter over the scope, then its cap."""
    reading = view_reading(session, rule.view_measure, sort=rule.sort)
    filters = PostFilters(
        keyword=rule.keyword,
        tree=rule.tree,
        tree_readings=tree_readings(session, rule.tree),
        reading=reading,
    )
    clauses = [*scope.clauses(), *post_filter_clauses(filters, followed_names=followed)]
    if rule.max_per_channel <= 0:
        return and_(true(), *clauses)
    # The cap ranks among the Posts the rule's filter keeps in this window, as
    # the feed's cap does, and with the seed the rule was made with, so a
    # random cap gives the same Posts every time in one window.
    order = (
        [random_cap_order(rule.seed)]
        if rule.max_per_channel_mode == "random"
        else channel_order(rule.sort, Post, reading)
    )
    rank = func.row_number().over(partition_by=col(Post.channel_name), order_by=order)
    ranked = (
        scoped_select(
            select(col(Post.channel_name), col(Post.post_id), rank.label("rn")),
            Post,
            scope.user_id,
        )
        .where(*clauses)
        .subquery()
    )
    return tuple_(col(Post.channel_name), col(Post.post_id)).in_(
        select(ranked.c.channel_name, ranked.c.post_id).where(
            ranked.c.rn <= rule.max_per_channel
        )
    )


def selection_clause(
    session: Session, steps: Sequence[Step] | None, scope: PostScope
) -> ColumnElement[bool]:
    """Whether each Post the enclosing read covers is selected.

    The enclosing read keeps the follow scope; a Pick or a rule naming a
    Channel the caller does not follow reaches a Post that read never returns,
    which is nothing, and is not an error. `None` is the default, select all.
    """
    steps = SELECT_ALL if steps is None else steps
    followed = (
        frozenset(visible_channel_names(session, user_id=scope.user_id))
        if any(
            isinstance(s, Rule)
            and s.tree is not None
            and TypeCond("unfollowed_forwarded") in tree_conds(s.tree)
            for s in steps
        )
        else None
    )
    branches = [
        (_reached(session, step, scope, followed), step.select)
        if isinstance(step, Rule)
        else (_picked(step[1]), step[0])
        for step in _compressed(steps)
    ]
    if not branches:
        return false()
    return case(
        *(
            (reach, true() if chosen else false())
            for reach, chosen in reversed(branches)
        ),
        else_=false(),
    )


def selected_refs(
    session: Session,
    steps: Sequence[Step] | None,
    scope: PostScope,
    *,
    sort: FeedSort = "newest",
    view_measure: ViewMeasure = "estimated",
    group_by_channel: bool = False,
) -> list[tuple[str, int]]:
    """Every selected Post in the scope, in the feed's order, as references.

    What an Artifact freezes: no text, and no bound, since it records exactly
    what an Action covered however many that was.
    """
    reading = view_reading(session, view_measure, sort=sort)
    stmt = scoped_select(
        select(col(Post.channel_name), col(Post.post_id)), Post, scope.user_id
    )
    if scope.channel_names:
        stmt = stmt.where(col(Post.channel_name).in_(scope.channel_names))
    stmt = apply_analysis_window(stmt, scope.start_date, scope.end_date).where(
        selection_clause(session, steps, scope)
    )
    rows = session.exec(
        stmt.order_by(*feed_order_by(sort, group_by_channel, Post, reading))
    ).all()
    return [(name, post_id) for name, post_id in rows]


def freeze_selection(
    session: Session,
    submission: ScopeSubmission,
    *,
    user_id: uuid.UUID,
    now_ms: int | None = None,
) -> FrozenScope:
    """Freeze a submitted Scope with every Post its selection reached.

    The door every Action submits through (PTR-05). The window is frozen
    first, by `freeze_scope`, and the selection is applied over it once, so
    the references an Artifact keeps are the Posts it covered at that minute
    and inspecting it later never applies a rule to today's corpus.
    """
    frozen = freeze_scope(submission, now_ms=now_ms)
    refs = selected_refs(
        session,
        to_steps(submission.selection),
        PostScope(user_id, frozen.channels or None, frozen.start, frozen.end),
        sort=frozen.sort,
        view_measure=frozen.view_measure,
        group_by_channel=frozen.group_by_channel,
    )
    # ponytail: every reference in one JSON column, unbounded as ADR-026 says;
    # a window of a million Posts stores a million refs. Bound it, or store a
    # table of refs, if a deployment ever summarizes windows that size.
    return FrozenScope.model_validate(
        {
            **frozen.stored(),
            "posts": [{"channelName": c, "postId": p} for c, p in refs],
        }
    )
