"""The Post selection: which Posts an Action covers (PTR-05, ADR-026).

An ordered list of steps. A **Selection rule** selects or deselects every Post
its Post filter matches in the current window and Channels, so it reaches new
Posts when the window moves. A **Pick** selects or deselects one Post, in any
window. The last step to reach a Post decides it, and a Post no step reaches is
not selected. The default is one rule, select all, so an Account that never
touches it covers every Post in the window, as before.

The browser never evaluates it: every read the Posts tab makes asks for the
`selected` flag, and every Action resolves the selection through a Posts view
(`posts_view`), which compiles it here.

`selection_clause` is one predicate over `Post`, for whatever read encloses it:
a `CASE` over the steps from last to first, which is "last step wins" spelled
in SQL. Picks go in as `VALUES` lists, which Postgres hashes once per query,
so 5,000 of them cost a probe per row rather than a scan.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import (
    ColumnElement,
    Integer,
    String,
    and_,
    case,
    column,
    false,
    func,
    not_,
    true,
    tuple_,
    values,
)
from sqlmodel import Session, col, select

from app.models_tg import Post
from app.services.follows import visible_channel_names
from app.services.post_filters import (
    SELECT_ALL,
    Cap,
    Estimate,
    Pick,
    PostFilters,
    PostScope,
    Rule,
    Step,
    post_filter_clauses,
    ranked_per_channel,
    reading_of,
    reads_estimate,
    reads_unfollowed,
    tree_readings,
)
from app.services.settling_curve import current_estimate


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
    rule: Rule,
    scope: PostScope,
    estimate: Estimate | None,
    followed: frozenset[str] | None,
) -> ColumnElement[bool]:
    """The Posts `rule` reaches: its filter's over the scope, or with `negated` the rest."""
    matched = _matched(rule, scope, estimate, followed)
    # A keyword over a Post with no text is NULL, which NOT keeps NULL; the
    # coalesce makes "not matched" two-valued, as the tree's atoms are.
    return not_(func.coalesce(matched, false())) if rule.negated else matched


def _matched(
    rule: Rule,
    scope: PostScope,
    estimate: Estimate | None,
    followed: frozenset[str] | None,
) -> ColumnElement[bool]:
    """The Posts `rule`'s filter matches over the scope, then its cap."""
    reading = reading_of(rule.view_measure, estimate)
    filters = PostFilters(
        keyword=rule.keyword,
        tree=rule.tree,
        tree_readings=tree_readings(rule.tree, estimate),
        reading=reading,
    )
    kept = post_filter_clauses(filters, followed_names=followed, scope=scope)
    if rule.max_per_channel <= 0:
        return and_(true(), *scope.clauses(), *kept)
    # The cap ranks among the Posts the rule's filter keeps in this window, as
    # the feed's cap does, and with the seed the rule was made with, so a
    # random cap gives the same Posts every time in one window.
    ranked = ranked_per_channel(
        select(col(Post.channel_name), col(Post.post_id)),
        scope,
        kept,
        Cap(
            rule.max_per_channel,
            rule.max_per_channel_mode,
            rule.sort,
            rule.seed,
            reading,
        ),
    )
    return tuple_(col(Post.channel_name), col(Post.post_id)).in_(
        select(ranked.c.channel_name, ranked.c.post_id).where(
            ranked.c.rn <= rule.max_per_channel
        )
    )


def _rules(steps: Sequence[Step]) -> list[Rule]:
    return [s for s in steps if isinstance(s, Rule)]


def rules_read_estimate(steps: Sequence[Step]) -> bool:
    """Whether a Selection rule's bounds or cap order read an Estimated View count."""
    return any(reads_estimate(r.tree, r.sort, r.view_measure) for r in _rules(steps))


def rules_read_unfollowed(steps: Sequence[Step]) -> bool:
    """Whether a Selection rule's filter needs the followed-channel set."""
    return any(reads_unfollowed(r.tree) for r in _rules(steps))


def compile_selection(
    steps: Sequence[Step],
    scope: PostScope,
    *,
    estimate: Estimate | None,
    followed: frozenset[str] | None,
) -> ColumnElement[bool]:
    """Whether each Post the enclosing read covers is selected, from what is loaded.

    Every rule reads through the one `estimate` and the one `followed` set,
    loaded by the caller when `rules_read_estimate` and
    `rules_read_unfollowed` say a rule needs them, so a selection with many
    rules reads the curve once.
    """
    branches = [
        (_reached(step, scope, estimate, followed), step.select)
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


def selection_clause(
    session: Session, steps: Sequence[Step] | None, scope: PostScope
) -> ColumnElement[bool]:
    """Whether each Post the enclosing read covers is selected.

    The enclosing read keeps the follow scope; a Pick or a rule naming a
    Channel the caller does not follow reaches a Post that read never returns,
    which is nothing, and is not an error. `None` is the default, select all.
    Loads what its rules read, once; a Posts view compiles its selection with
    what it loaded instead (`posts_view.resolve_posts_view`).
    """
    steps = SELECT_ALL if steps is None else steps
    return compile_selection(
        steps,
        scope,
        estimate=current_estimate(session) if rules_read_estimate(steps) else None,
        followed=frozenset(visible_channel_names(session, user_id=scope.user_id))
        if rules_read_unfollowed(steps)
        else None,
    )
