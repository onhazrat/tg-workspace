"""The Post filter's tree and the Post selection, as a request carries them.

Apart from `posts.py` because the Scope (`scope.py`) carries a Post selection
and `posts.py` imports the Scope, so the two could not import each other.

Docstrings stay to one line: a model docstring ships in `openapi.json` and
the generated client, so the reasoning lives in comments.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.services.post_filters import (
    CapMode,
    ChannelCond,
    FeedSort,
    LanguageCond,
    MediaCond,
    MediaKind,
    Pick,
    PostType,
    Rule,
    Step,
    TreeAtom,
    TreeCond,
    TreeGroup,
    TypeCond,
    ViewMeasure,
    ViewsCond,
)

# ---- The Post filter's tree on the wire (PTR-03) -----------------------------
#
# The browser's tree, `frontend/src/lib/filter-tree.ts`, as
# `post_filters.TreeGroup` reads it. The nodes carry the browser's `id` so a
# tree round-trips untouched; the server never reads it. `extra="forbid"` for
# the reason the Scope gives: an unknown Condition is a 422, never a filter
# that quietly matches everything. A tree is SQL the server builds, so its
# size is bounded too.

MAX_FILTER_DEPTH = 6
MAX_FILTER_NODES = 100


class _Cond(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TypeCondition(_Cond):
    type: Literal["type"]
    value: PostType


class MediaCondition(_Cond):
    type: Literal["media"]
    value: MediaKind


class LanguageCondition(_Cond):
    type: Literal["language"]
    value: str = Field(min_length=1, max_length=16)


class ChannelCondition(_Cond):
    type: Literal["channel"]
    value: str = Field(min_length=1, max_length=256)


class ViewsCondition(_Cond):
    type: Literal["views"]
    measure: ViewMeasure
    min: float | None = Field(None, ge=0)
    max: float | None = Field(None, ge=0)
    none: bool = False


PostCondition = Annotated[
    TypeCondition
    | MediaCondition
    | LanguageCondition
    | ChannelCondition
    | ViewsCondition,
    Field(discriminator="type"),
]


class FilterAtom(BaseModel):
    """One Condition, maybe negated."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: Literal["atom"]
    id: str | None = None
    negated: bool = Field(False, alias="not")
    cond: PostCondition


class FilterGroup(BaseModel):
    """Conditions joined with AND or OR, maybe negated; parentheses are groups."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: Literal["group"]
    id: str | None = None
    op: Literal["and", "or"]
    negated: bool = Field(False, alias="not")
    children: list[Annotated[FilterAtom | FilterGroup, Field(discriminator="kind")]] = (
        Field(default_factory=list)
    )

    # Every nested group runs this too, each from its own depth of 1, so only
    # the root's walk is the one that can refuse; the others are smaller.
    @model_validator(mode="after")
    def _bounded(self) -> FilterGroup:
        def walk(node: FilterAtom | FilterGroup, depth: int) -> int:
            if depth > MAX_FILTER_DEPTH:
                raise ValueError(f"filter deeper than {MAX_FILTER_DEPTH}")
            if isinstance(node, FilterAtom):
                return 1
            return 1 + sum(walk(child, depth + 1) for child in node.children)

        if walk(self, 1) > MAX_FILTER_NODES:
            raise ValueError(f"filter larger than {MAX_FILTER_NODES} nodes")
        return self

    def to_tree(self) -> TreeGroup:
        return TreeGroup(
            op=self.op,
            negated=self.negated,
            children=tuple(
                TreeAtom(cond=_cond(child.cond), negated=child.negated)
                if isinstance(child, FilterAtom)
                else child.to_tree()
                for child in self.children
            ),
        )


def _cond(
    cond: TypeCondition
    | MediaCondition
    | LanguageCondition
    | ChannelCondition
    | ViewsCondition,
) -> TreeCond:
    if isinstance(cond, TypeCondition):
        return TypeCond(cond.value)
    if isinstance(cond, MediaCondition):
        return MediaCond(cond.value)
    if isinstance(cond, LanguageCondition):
        return LanguageCond(cond.value)
    if isinstance(cond, ChannelCondition):
        return ChannelCond(cond.value)
    return ViewsCond(cond.measure, cond.min, cond.max, cond.none)


# ---- The Post selection on the wire (PTR-05, ADR-026) -----------------------
#
# An ordered list of steps, last one to reach a Post wins. A rule carries the
# Post filter it was made with, cap and seed included, so applying it again in
# another window reaches the Posts it would have reached there. A Pick names
# one Post. Bounded for the reason the tree is: it is SQL the server builds.

#: The limit explicitly named Posts had before (ADR-026).
MAX_SELECTION_PICKS = 5000
MAX_SELECTION_RULES = 50


class PostFilterSnapshot(BaseModel):
    """A Post filter as it was when a Selection rule was made."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    tree: FilterGroup | None = None
    # Bounded, unlike the feed's: fifty rules would multiply an unbounded one.
    keyword: str | None = Field(None, max_length=500)
    # The order an `ordered` cap keeps the first N of, and what views read.
    sort: FeedSort = "newest"
    view_measure: ViewMeasure = Field("estimated", alias="viewMeasure")
    max_per_channel: int = Field(0, alias="maxPerChannel", ge=0)
    max_per_channel_mode: CapMode = Field("ordered", alias="maxPerChannelMode")
    seed: int = 0


class SelectionRule(BaseModel):
    """Select or deselect every Post a Post filter matches."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["rule"]
    select: bool
    filter: PostFilterSnapshot = Field(
        default_factory=lambda: PostFilterSnapshot.model_validate({})
    )


class SelectionPick(BaseModel):
    """Select or deselect one Post."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: Literal["pick"]
    select: bool
    channel_name: str = Field(alias="channelName", min_length=1, max_length=256)
    post_id: int = Field(alias="postId")


def _bounded(
    steps: list[SelectionRule | SelectionPick],
) -> list[SelectionRule | SelectionPick]:
    picks = sum(isinstance(step, SelectionPick) for step in steps)
    if picks > MAX_SELECTION_PICKS:
        raise ValueError(
            f"more than {MAX_SELECTION_PICKS} picked Posts; use a Selection rule"
        )
    if len(steps) - picks > MAX_SELECTION_RULES:
        raise ValueError(f"more than {MAX_SELECTION_RULES} Selection rules")
    return steps


PostSelection = Annotated[
    list[Annotated[SelectionRule | SelectionPick, Field(discriminator="kind")]],
    AfterValidator(_bounded),
]


def select_all() -> list[SelectionRule | SelectionPick]:
    """The default selection: one rule, select every Post."""
    return [SelectionRule(kind="rule", select=True)]


def to_steps(selection: list[SelectionRule | SelectionPick]) -> tuple[Step, ...]:
    """The wire steps as the service evaluates them."""
    steps: list[Step] = []
    for step in selection:
        if isinstance(step, SelectionPick):
            steps.append(Pick(step.select, step.channel_name, step.post_id))
            continue
        snap = step.filter
        steps.append(
            Rule(
                select=step.select,
                tree=None if snap.tree is None else snap.tree.to_tree(),
                keyword=snap.keyword,
                sort=snap.sort,
                view_measure=snap.view_measure,
                max_per_channel=snap.max_per_channel,
                max_per_channel_mode=snap.max_per_channel_mode,
                seed=snap.seed,
            )
        )
    return tuple(steps)


def legacy_selection(data: dict[str, Any]) -> dict[str, Any]:
    """Read a Scope in the shape before PTR-05 as a Post selection, for one release.

    A browser on the previous bundle sends the keyword, the cap and, for a
    meaning search, the ranked `posts`. Ranked Posts are deselect-all then one
    Pick each; otherwise the keyword and cap are one select rule, which is the
    Posts the old Scope covered. A body that already names `selection` is left
    for `extra="forbid"` to refuse its strays.
    """
    keys = {
        "keyword": "keyword",
        "maxPerChannel": "maxPerChannel",
        "max_per_channel": "maxPerChannel",
        "maxPerChannelMode": "maxPerChannelMode",
        "max_per_channel_mode": "maxPerChannelMode",
        "seed": "seed",
    }
    ranked_key = next((k for k in ("posts", "postIds", "post_ids") if k in data), None)
    if "selection" in data or (ranked_key is None and not keys.keys() & data.keys()):
        return data
    upgraded = dict(data)
    snapshot = {keys[k]: upgraded.pop(k) for k in list(upgraded) if k in keys}
    ranked = upgraded.pop(ranked_key) if ranked_key else None
    if ranked is not None:
        upgraded["selection"] = [
            {"kind": "rule", "select": False},
            *({"kind": "pick", "select": True, **ref} for ref in ranked),
        ]
        return upgraded
    snapshot = {k: v for k, v in snapshot.items() if v is not None}
    for key in ("sort", "viewMeasure"):
        if key in upgraded:
            snapshot[key] = upgraded[key]
    upgraded["selection"] = [{"kind": "rule", "select": True, "filter": snapshot}]
    return upgraded
