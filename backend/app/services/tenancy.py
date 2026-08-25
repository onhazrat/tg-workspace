"""The one place that decides which rows a User may see (ticket 03, plan step A2).

**This module is inert today.** `TENANCY_ENFORCED` ships `False`, and while it
is off `scoped_select` hands back the statement it was given, unchanged. That is
the point: the ~40 read paths that have never had an owner filter can adopt the
seam one batch at a time, and no batch changes a single response until ticket 21
flips the flag with an isolation guard behind it.

## Why a classification and not a `user_id` filter

The obvious version of this module is one line — `.where(Model.user_id ==
user_id)` — and it is wrong for most of the schema. Two findings from the plan
drive the shape here:

* **The corpus is already physically shared.** `Channel.id` is the handle,
  `Post` is unique per `(channel_name, post_id)`, and embeddings and
  translations are keyed the same way. `user_id` on those tables was only ever a
  "who scraped this first" stamp, and filtering on it would give a second
  follower of a channel an empty page for posts that are sitting right there.
  Those tables are scoped by *who follows the channel* — an EXISTS against
  `tg_channel_follows`, which ticket 04 created and backfilled — and their
  `user_id` columns are dropped in ticket 22.
* **Two shared tables are not follow-scoped at all.** A probe is a fact about a
  handle ("cannot be followed by anyone") and `SyncMeta` is a cache etag. They
  are unscoped deliberately, which is a thing worth writing down precisely
  because an unscoped read is otherwise indistinguishable from a forgotten one.

So the dispatch is by model class, and every table in the schema is placed in
`SCOPES` or excused in `OUT_OF_SCOPE` with a reason. `test_tenancy_seam.py`
fails on a table nobody placed — being made to answer "whose rows are these?"
when the table is created is most of this module's value.

## A pure transform

It builds statements and compares identifiers. It executes nothing and takes no
`Session`, so it is registered as a pure transform in `test_service_kinds.py`
and acquiring database access later turns the suite red. That also means the
scoping rules can be tested without a fixture, and a scoping rule that needs a
database to check is one nobody checks.
"""

from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Any

from fastapi import HTTPException
from sqlalchemy.sql import Select
from sqlmodel import SQLModel, col, select

from app.core.config import settings
from app.models import Item, User
from app.models_rbac import Role, UserRole
from app.models_tg import (
    AppSetting,
    BotCredential,
    Channel,
    ChannelFollow,
    ChannelSettingGroup,
    ChatDestination,
    ChatSession,
    ChatSessionPayload,
    DiscoverHandleProbe,
    DiscoverIgnoredChannel,
    DiscoverReport,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostSyncState,
    PostTranslation,
    PublishLog,
    QuotaUsage,
    Summary,
    SummaryPayload,
    SyncJob,
    SyncLog,
    SyncLogPayload,
    SyncMeta,
    TagRun,
    UserSetting,
)

#: Every user-owned table stamps its owner in the same column. Named once
#: rather than repeated, because the day one table spells it differently is
#: the day this module needs to know that, not the day a query returns wrong.
OWNER_COLUMN = "user_id"


class Scope(StrEnum):
    """What kind of data a table holds, from the seam's point of view."""

    #: Private to one account: filter on the row's own `user_id`.
    USER_OWNED = "user-owned"

    #: Shared corpus reachable through a Channel: an EXISTS against the follow
    #: table. Never filtered on `Model.user_id` — those columns are stamps from
    #: whoever scraped the row first, and ticket 22 drops them.
    FOLLOW_SCOPED = "follow-scoped"

    #: Shared and not reachable through a follow. Unscoped on purpose.
    CORPUS = "corpus"


#: Every table the seam is responsible for: 19 user-owned, and the 7 shared ones
#: the plan's decision 1 names — 5 of which a follow can reach and 2 of which it
#: cannot. Note `Scope.CORPUS` is the narrower of those two senses.
SCOPES: dict[type[SQLModel], Scope] = {
    # --- User-owned: artifacts, credentials, destinations, settings, setting
    # groups, sync jobs, and logs. Everything a User produces rather than reads.
    ChannelSettingGroup: Scope.USER_OWNED,
    # Which channels you watch is private (user story 9). User-owned rather
    # than follow-scoped: scoping the follow table *by* an EXISTS against
    # itself is circular, and the row already names its owner.
    ChannelFollow: Scope.USER_OWNED,
    Summary: Scope.USER_OWNED,
    SummaryPayload: Scope.USER_OWNED,
    ChatSession: Scope.USER_OWNED,
    ChatSessionPayload: Scope.USER_OWNED,
    DiscoverReport: Scope.USER_OWNED,
    DiscoverIgnoredChannel: Scope.USER_OWNED,
    TagRun: Scope.USER_OWNED,
    BotCredential: Scope.USER_OWNED,
    ChatDestination: Scope.USER_OWNED,
    UserSetting: Scope.USER_OWNED,
    PublishLog: Scope.USER_OWNED,
    SyncLog: Scope.USER_OWNED,
    SyncLogPayload: Scope.USER_OWNED,
    LLMLog: Scope.USER_OWNED,
    EmbeddingLog: Scope.USER_OWNED,
    NetworkLog: Scope.USER_OWNED,
    SyncJob: Scope.USER_OWNED,
    # What you spent is yours to see. User-owned even though the only reader
    # today is the Admin view, which crosses accounts on purpose and says so
    # through `unscoped_select` — an escape hatch is only meaningful where the
    # default would have scoped.
    QuotaUsage: Scope.USER_OWNED,
    # --- Follow-scoped: one scrape serves every follower.
    Channel: Scope.FOLLOW_SCOPED,
    Post: Scope.FOLLOW_SCOPED,
    PostSyncState: Scope.FOLLOW_SCOPED,
    PostEmbedding: Scope.FOLLOW_SCOPED,
    PostTranslation: Scope.FOLLOW_SCOPED,
    # --- Corpus: shared, and no follow can reach them.
    DiscoverHandleProbe: Scope.CORPUS,
    SyncMeta: Scope.CORPUS,
}

#: The column naming the Channel a follow-scoped row belongs to, for the EXISTS
#: in `scoped_select`. The join key is a string throughout rather than a
#: surrogate id — recorded here because that is easy to misremember.
#:
#: **The two spellings do not hold the same value.** `Channel.id` is the
#: primary key the follow's foreign key points at; `channel_name` holds
#: `Channel.name`, which is writable and diverges the moment a channel is
#: renamed. `scoped_select` joins through `tg_channels` for that reason rather
#: than comparing the foreign key to `channel_name` directly.
FOLLOW_KEYS: dict[type[SQLModel], str] = {
    Channel: "id",
    Post: "channel_name",
    PostSyncState: "channel_name",
    PostEmbedding: "channel_name",
    PostTranslation: "channel_name",
}

#: Tables the seam is deliberately not responsible for, and why. An exemption
#: nothing explains becomes a leftover nobody dares touch.
OUT_OF_SCOPE: dict[type[SQLModel], str] = {
    AppSetting: (
        "Deployment-wide settings after the ticket 06 split: one row per key, "
        "shared by every account by definition, and `key` is the whole primary "
        "key so there is no per-user row for the seam to hide. Who may *write* "
        "one is an Admin permission question, not a row-visibility one — the "
        "same argument `Role` makes. The per-User half is `UserSetting`, which "
        "is classified above."
    ),
    User: (
        "The tenant itself, not something a tenant owns. Scoping the user table "
        "to a user is circular; who may list or edit accounts is an RBAC "
        "question answered by a permission constant, not by row visibility."
    ),
    Item: (
        "Template scaffolding on its own `owner_id`, deleted in ticket 29. "
        "Classifying it would teach the seam a second owner-column name for a "
        "table that is on its way out."
    ),
    Role: (
        "Authorisation data, shared by definition — the three seeded roles are "
        "the same rows for every account. Scoping them per user is what a "
        "permission-editor UI would need, and there is deliberately none."
    ),
    UserRole: (
        "A User's role assignments, read only by `services/rbac.py` for one "
        "explicit user id and never listed. There is no unscoped query here for "
        "the seam to scope; the lookup already names whose roles it wants."
    ),
}


def tenancy_enforced() -> bool:
    """The only place `TENANCY_ENFORCED` is read.

    A flag read in one place can be turned on, forced in a test, or removed by
    touching one function. Read in fourteen places it is a convention, and
    conventions here drift — the two auth gates that disagreed about
    `/password-recovery` for months are the same shape of bug.
    `test_tenancy_seam.py` asserts the count stays at one.
    """
    return settings.TENANCY_ENFORCED


def scope_of(model: type[SQLModel]) -> Scope:
    """The tenancy classification of `model`, or `KeyError` if it has none.

    Failing on an unknown model rather than passing it through is the whole
    point: a table nobody classified is a table whose rows nobody decided the
    ownership of, and defaulting it to "visible" is the leak this seam exists
    to prevent.
    """
    try:
        return SCOPES[model]
    except KeyError:
        reason = OUT_OF_SCOPE.get(model)
        if reason is not None:
            msg = f"{model.__name__} is deliberately not tenancy-scoped: {reason}"
        else:
            msg = (
                f"{model.__name__} has no tenancy classification. Add it to "
                f"SCOPES as user-owned, follow-scoped, or corpus, or to "
                f"OUT_OF_SCOPE with a reason."
            )
        raise KeyError(msg) from None


def scoped_select[StatementT: Select[Any]](
    statement: StatementT,
    model: type[SQLModel],
    user_id: uuid.UUID,
) -> StatementT:
    """Narrow `statement` to the rows `user_id` may see.

    Returns the statement untouched while `TENANCY_ENFORCED` is off, which is
    what lets a call site adopt this before the flag flips and stay
    byte-identical to what it does today.

    `user_id` is **not** optional, deliberately. Every route that reads these
    tables already depends on `CurrentUser`, so a caller always has a real id;
    accepting `None` would mean inventing a meaning for "no user", and the
    tempting one — match the rows whose owner is NULL — hands an unauthenticated
    caller every row written before the stamp existed. A caller holding an
    optional id has to decide what that means, in the open.
    """
    if not tenancy_enforced():
        return statement

    scope = scope_of(model)

    if scope is Scope.CORPUS:
        return statement

    if scope is Scope.FOLLOW_SCOPED:
        # An EXISTS against the follow table, never a filter on
        # `Model.user_id`. Those columns are a "who scraped this first" stamp,
        # and ticket 22 drops them; filtering on one would hand the second
        # follower of a channel an empty page for posts sitting right there.
        #
        # A semi-join rather than a JOIN, because a JOIN multiplies rows when a
        # channel has several followers and the caller's LIMIT would then be
        # counting the wrong thing. EXISTS also lets PostgreSQL stop at the
        # first matching follow.
        join_column = getattr(model, FOLLOW_KEYS[model])
        follows = select(ChannelFollow).where(ChannelFollow.user_id == user_id)

        if model is Channel:
            # The follow names the Channel by its primary key.
            return statement.where(
                follows.where(ChannelFollow.channel_id == join_column).exists()
            )

        # Everything else keys on `channel_name`, which holds `Channel.name` —
        # **not** `Channel.id`. Nothing keeps those two equal: `name` is
        # writable through `PUT /data/channels/{id}` (`apply_channel_fields`
        # excludes only `id`, `user_id`, and `setting_group_id`) and an import
        # sets them from separate fields. Correlating the FK directly against
        # `channel_name` therefore compiles, runs, and silently returns nothing
        # for every renamed channel — which is the "syntactically right,
        # semantically wrong" failure a compiled-SQL assertion cannot see. So
        # the EXISTS goes through `tg_channels` and compares name to name.
        return statement.where(
            follows.join(Channel, col(Channel.id) == col(ChannelFollow.channel_id))
            .where(col(Channel.name) == join_column)
            .exists()
        )

    return statement.where(getattr(model, OWNER_COLUMN) == user_id)


def assert_owner(
    owner_id: uuid.UUID | None,
    user_id: uuid.UUID,
    *,
    detail: str,
) -> None:
    """Refuse a row that is not the caller's, as a 404 rather than a 403.

    403 confirms the row exists, which is an enumeration oracle: "you may not
    see this" and "there is nothing here" are the same answer to someone who
    should not be able to tell the difference, and only one of them leaks. The
    signup endpoint answers this way for the same reason.

    **`detail` is required, and must be the exact string this route already
    uses for a row that does not exist.** The status code is only half the
    answer — every 404 in this codebase is resource-specific (`"Summary not
    found"`, `"Channel not found"`, `f"{log_type} log not found"`), so a
    generic `"Not found"` here would make "someone else owns it" and "it is not
    there" trivially distinguishable by reading the body, and the oracle this
    function exists to close would simply move from the status line to the
    payload. A default value would be the trap, so there is none.

    A no-op while the flag is off. Rows written before the `user_id` stamp
    existed carry NULL, and enforcing on those would fail closed against the
    only account a single-operator install has.
    """
    if not tenancy_enforced():
        return

    if owner_id is None or owner_id != user_id:
        raise HTTPException(status_code=404, detail=detail)


def unscoped_select[StatementT: Select[Any]](
    statement: StatementT,
    *,
    reason: str,  # noqa: ARG001 — the point is that it is written, not used
) -> StatementT:
    """Read across every account on purpose, with the purpose written down.

    Returns the statement untouched — it is a no-op by construction. The value
    is entirely in what it makes greppable: decision 6 of the plan makes export
    Admin-only "for themselves **or for all users**", and `routes/data/admin.py`
    reads across accounts by design, so some call sites genuinely must not
    scope. Without this they would be bare `select(Model)` calls, and this
    module's own argument is that an unscoped read is otherwise
    indistinguishable from a forgotten one.

    `reason` is required for the same purpose `OUT_OF_SCOPE` states one: an
    exception nothing explains becomes a leftover nobody dares touch.
    """
    return statement
