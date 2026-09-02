"""The one place that decides which rows a User may see (ticket 03, plan step A2).

**This module is live.** `TENANCY_ENFORCED` ships `True` since ticket 21 PR 4,
so `scoped_select` filters: a user-owned row by its owner, a follow-scoped one
by an `EXISTS` against `tg_channel_follows`, and corpus not at all.

It was inert for eighteen tickets, and that is why the adoption reads the way it
does — with the flag off `scoped_select` handed back the statement it was given,
unchanged, so ~40 read paths could take the seam one batch at a time without any
batch changing a response. Two adoptions changed one deliberately, and both say
so where they are made.

**Off is now the rollback**, not the default. The disabled branch is still
asserted byte-identical to the pre-seam queries for all 27 models
(`test_tenancy_seam.py`), so an operator can revert every read path at once by
setting the flag false — at the cost of every account seeing every account's
rows again, which `test_account_isolation.py` states outright.

The one deliberate exception to the flag was and remains
`assert_owner_on_write`, which is ungated: refusing to overwrite a row that is
already somebody else's is not a response anybody was reading

The exception is `assert_owner_on_write`, which refuses a foreign row whichever
way the flag points (ticket 31). The flag gates *visibility*, and the reason it
can be off is that a read answering differently would be a changed response.
Overwriting a row that is already somebody else's is not a read, and no response
moves when it is refused on a deployment that has one account — so gating it
would buy nothing and leave the clobber open on the deployment that has it.
Ticket 30 made the same call for the same reason: a flag cannot gate identity.

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
from typing import Any, NamedTuple, cast

from fastapi import HTTPException
from sqlalchemy import Table
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
    QuotaLimit,
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
from app.models_view_as import ViewAsSession

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


#: Every table the seam is responsible for: 27 in all. 18 user-owned, and the 9
#: shared ones the plan's decision 1 names — 7 of which a follow can reach and 2
#: of which it cannot. Note `Scope.CORPUS` is the narrower of those two senses.
#:
#: Sync logs and their payload rows joined the follow-scoped group in ticket 19.
#: They are the only members that are not corpus a scrape produced; they are the
#: record *of* the scrape, which is a fact about the Channel just the same.
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
    LLMLog: Scope.USER_OWNED,
    EmbeddingLog: Scope.USER_OWNED,
    NetworkLog: Scope.USER_OWNED,
    SyncJob: Scope.USER_OWNED,
    # What you spent is yours to see. User-owned even though the only reader
    # today is the Admin view, which crosses accounts on purpose and says so
    # through `unscoped_select` — an escape hatch is only meaningful where the
    # default would have scoped.
    QuotaUsage: Scope.USER_OWNED,
    # The limits an Admin set for you are yours to see, for the same reason the
    # spend is: a warning that says "you are out" is unreadable without the
    # number you are out of. `GET /quota/me` reads this account's rows through
    # the seam; the Admin view crosses accounts through `unscoped_select`.
    QuotaLimit: Scope.USER_OWNED,
    # --- Follow-scoped: one scrape serves every follower.
    Channel: Scope.FOLLOW_SCOPED,
    Post: Scope.FOLLOW_SCOPED,
    PostSyncState: Scope.FOLLOW_SCOPED,
    PostEmbedding: Scope.FOLLOW_SCOPED,
    PostTranslation: Scope.FOLLOW_SCOPED,
    # A sync log answers "did this Channel deliver Posts, and if not why not",
    # which is a fact about the Channel and not about whoever triggered the
    # scrape (ticket 19, plan decision 22). Owned by nobody: a nullable owner
    # meaning "the scheduler wrote this" is the `operator.py` ambiguity, and it
    # fails open on a forgotten stamp. The payload row takes its parent's scope
    # the way `SummaryPayload` does — a child claiming an owner its parent does
    # not have would make the bodies searchable and the log unreadable.
    SyncLog: Scope.FOLLOW_SCOPED,
    SyncLogPayload: Scope.FOLLOW_SCOPED,
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
    SyncLog: "channel_name",
    # Denormalised onto the payload row by ticket 19's migration, for the same
    # reason `timestamp` is: reaching the parent's name through a join would put
    # `tg_sync_logs` (191k rows on staging) inside the predicate of every read
    # of the table the payload split exists to keep cheap.
    SyncLogPayload: "channel_name",
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
    ViewAsSession: (
        "An audit record of an administrative act (ticket 26), not something "
        "either account it names owns. Scoping it to the subject would hide "
        "from an Owner exactly the trail the table exists to keep, and scoping "
        "it to the actor would answer 'who has been looking at accounts' with "
        "'only you'. Who may read it is a permission question — `VIEW_AS`, the "
        "same one that lets somebody start a session — which is the argument "
        "`Role` makes. It is also the one table here whose foreign keys do not "
        "cascade, so a deleted account leaves rows the seam could not scope "
        "even if it wanted to."
    ),
}


class OwnerBackfill(NamedTuple):
    """One table ticket 34's backfill has to stamp, and where its owner comes from.

    `parent_table` is set only for a payload row, whose owner is its parent's
    owner rather than the deployment's. The other fields name the columns that
    join the two, because the child spells the key for its parent
    (`summary_id`) and the parent spells it `id` — a single name would be
    wrong at one end and still compile.
    """

    table: str
    parent_table: str | None = None
    child_key: str | None = None
    parent_key: str | None = None


#: Child tables whose owner is **their parent's owner**, never the operator's.
#:
#: Both are payload halves split off a parent row for the TOAST reason their
#: model docstrings give. A payload has no independent existence: it is read
#: only through the `Summary` or `ChatSession` that names it, so stamping it
#: with the deployment operator while its parent belongs to somebody else
#: produces a row that is invisible to the one account that can reach it. Under
#: enforcement that is a detail view whose body is gone and whose parent is
#: still listed — the shape CLAUDE.md already names for `SyncLogPayload`: "a
#: child claiming an owner its parent does not have would make the bodies
#: searchable and the log unreadable".
#:
#: The naive backfill — every ownerless row to the operator — gets this wrong
#: and passes every test written on a single-account database, because there
#: the parent's owner *is* the operator. It takes a second account to tell the
#: two apart, which is why the guard for it seeds one.
OWNER_INHERITED_FROM: dict[type[SQLModel], tuple[type[SQLModel], str, str]] = {
    SummaryPayload: (Summary, "summary_id", "id"),
    ChatSessionPayload: (ChatSession, "chat_session_id", "id"),
}


def mapped_table(model: type[SQLModel]) -> Table:
    """The `Table` behind a model class.

    `model.__table__` is the obvious spelling and mypy rejects it under strict:
    SQLModel's class-level attribute is not on the `type[SQLModel]` it sees.
    Narrowed here once, so the cast is written down in one place with a reason
    instead of appearing at each of the four call sites as a bare
    `type: ignore` nobody can evaluate later.
    """
    return cast(Table, cast(Any, model).__table__)


def owner_backfill_inventory() -> tuple[OwnerBackfill, ...]:
    """Every table ticket 34 has to stamp, derived rather than listed.

    A `USER_OWNED` table whose `user_id` is not part of its primary key is a
    table that *could* hold a row nobody owns, and under enforcement such a row
    is invisible to every account and refused to every writer. Ticket 34's
    migration stamped them all; ticket 21's `d2e3f4a5b6c7` then made the columns
    `NOT NULL` with cascading keys, so the state is now unrepresentable rather
    than merely absent.

    **The criterion is primary-key membership, not nullability**, and the
    difference matters because the obvious version deletes itself: once ticket
    21 succeeds, "nullable `user_id`" matches nothing and this returns an empty
    inventory — silently un-guarding all fourteen tables and, in ticket 34's
    guard, reducing a `TRUNCATE {tables} CASCADE` to `TRUNCATE  CASCADE`.

    **Derived from `SCOPES`, the way `SHARED_LOG_TYPES` and `IMPORT_WRITES`
    are.** A hand-written list is the failure the ticket exists to prevent: a
    `USER_OWNED` table added next month and forgotten here surfaces as rows
    that vanish on the flip, which looks exactly like the seam working.

    Three groups fall out without needing an excuse written for each:

    * **Follow-scoped and corpus tables are not here.** Their `user_id` is a
      "who scraped this first" stamp that ticket 22 drops, and the seam
      deliberately never filters on it — stamping it would be work ticket 22
      deletes.
    * **The composite-key tables excuse themselves.** `ChannelFollow`,
      `DiscoverIgnoredChannel`, `QuotaUsage`, `QuotaLimit` and `UserSetting`
      carry `user_id` in a `NOT NULL` primary key, so a row without an owner
      cannot be expressed. That is a stronger excuse than any sentence: the database
      refuses the state rather than a guard asserting nobody reached it.
    * **A payload row is included, but not as an operator adoption** — see
      `OWNER_INHERITED_FROM`.

    The migration holds a **frozen** copy of this inventory rather than calling
    this function, and `test_owner_backfill.py` asserts the two agree. A
    migration is an artifact that must mean the same thing on every database
    for ever, so importing live app code into one makes an already-applied
    revision change meaning as the app moves, and a later rename breaks
    `alembic upgrade head` from an empty database. Deriving it live would not
    help the case the ticket cares about either — a table added after the
    revision has run is not reached by re-deriving, it needs a migration of its
    own. So the derivation lives in the guard, where "somebody added a table
    and forgot" is a red test instead of a silent gap.
    """
    inventory: list[OwnerBackfill] = []
    for model, scope in SCOPES.items():
        if scope is not Scope.USER_OWNED:
            continue
        column = mapped_table(model).columns.get(OWNER_COLUMN)
        # `not column.nullable` until ticket 21, and that criterion *deleted
        # itself*: PR 3 makes all fourteen non-null, so a nullability test
        # returns an empty inventory the moment it succeeds — taking ticket
        # 34's guard with it, and turning its `TRUNCATE {tables} CASCADE`
        # into `TRUNCATE  CASCADE`, which PostgreSQL reads as a table named
        # "cascade".
        #
        # Primary-key membership is the property that was doing the work all
        # along. The four excused tables — ChannelFollow, DiscoverIgnoredChannel,
        # QuotaUsage, UserSetting — carry `user_id` inside a composite primary
        # key, so they could never express an unowned row and never needed a
        # backfill. That is true before and after the columns become non-null,
        # which is what makes it the right question to ask.
        if column is None or column.primary_key:
            continue
        parent = OWNER_INHERITED_FROM.get(model)
        if parent is None:
            inventory.append(OwnerBackfill(table=mapped_table(model).name))
        else:
            parent_model, child_key, parent_key = parent
            inventory.append(
                OwnerBackfill(
                    table=mapped_table(model).name,
                    parent_table=mapped_table(parent_model).name,
                    child_key=child_key,
                    parent_key=parent_key,
                )
            )
    return tuple(sorted(inventory))


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


def may_act_on(*, owner_id: uuid.UUID | None, user_id: uuid.UUID | None) -> bool:
    """Whether `user_id` may use a row owned by `owner_id`, as a boolean.

    The same rule `assert_owner_on_write` raises on, for the callers that
    cannot raise an `HTTPException`. Ticket 33 has two of them and neither is
    serving a request: `publish_summary_text` runs in the scheduler and answers
    an unusable credential with `ValueError`, and `_auto_publish` has to write a
    publish log rather than propagate, because the scheduler is unattended and a
    refusal nobody records is a message that silently never arrives. Both would
    otherwise hand-roll `owner is not None and owner != actor`, which is the
    duplicated owner filter ticket 32 found three of.

    **A NULL on either side is unanswerable, so it is permitted while the flag
    is off and refused under enforcement.** For the row that is
    `assert_owner_on_write`'s existing asymmetry: legacy rows and anything a
    background job wrote carry no stamp, and refusing those fails closed against
    the only account a single-operator install has. For the *actor* it is the
    same argument from the other side — `run_auto_summary` deliberately picks up
    `Summary.user_id IS NULL` rows, so a send with no attributable owner is a
    live case today rather than a hypothetical. Under enforcement every row is
    stamped and neither NULL is legitimate, which makes ticket 21's owner
    backfill a prerequisite of the flip rather than a tidy-up after it.

    Note this is *not* the rule ticket 32 applied to the credential **lists**,
    which refuse to match a NULL owner as "mine". Handing every account the
    deployment's stored credential is a leak; declining to use one is not.

    **Both parameters are keyword-only.** They are the same type and the
    function is symmetric in them, so a transposed call site would compile, pass
    every test, and answer the wrong question — the names are the only thing
    distinguishing "whose row is this" from "who is asking", and a positional
    call throws that away.
    """
    if owner_id is None:
        # Nobody owns the row. Legacy rows and anything a background job wrote
        # carry no stamp, so refusing them fails closed against the only
        # account a single-operator install has.
        return not tenancy_enforced()

    if user_id is None:
        # Nobody is asking — an unattributed actor, which today means a Summary
        # written before the stamp existed and still picked up by
        # `run_auto_summary`. Deliberately the *same* answer as the branch
        # above and not the same reason: an unowned row is safe for anyone to
        # use, while an unattributed actor is merely impossible to refuse
        # without breaking the legacy operator's own auto-publish. The two are
        # written apart because they part company the moment ticket 21's
        # backfill removes one of them and not the other.
        return not tenancy_enforced()

    return owner_id == user_id


def assert_owner_on_write(
    owner_id: uuid.UUID | None,
    user_id: uuid.UUID,
    *,
    detail: str,
) -> None:
    """Refuse to overwrite a row that already belongs to somebody else.

    The write-path sibling of `assert_owner`, and the only thing in this module
    that does something while `TENANCY_ENFORCED` is off.

    Used by every by-id write and delete in `app/`: the import path, the four
    artifact families, the log door, and the two credential families.
    `assert_owner` is for reads only, and
    `test_import_write_scoping.py::test_only_reads_use_the_gated_ownership_guard`
    keeps the split honest — a write on the gated primitive goes on clobbering
    another account's row until ticket 21, which is how nine of them were found.

    **Why it is not gated.** The flag exists so that adopting the seam changes
    no *response*, and a refusal to clobber is not a response anyone was
    reading. On a single-account deployment there is no foreign row to refuse,
    so nothing moves; on one with a second account the gated version leaves the
    clobber exactly where it was, which makes gating a cost with no benefit.
    Ticket 30 reached this by another road: the owner in a composite key answers
    *which row is yours*, not *which rows you may see*, and a flag cannot gate
    identity.

    **A NULL owner is still writable while the flag is off**, which is the one
    asymmetry between the two states and the reason this is not just
    `owner_id != user_id`. Rows predating the stamp carry no owner, and so does
    anything a background job wrote — every log `upsert_*` takes `user_id` as
    optional. Refusing those would fail closed against the only account a
    single-operator install has, which is the trap `assert_owner`'s own
    docstring names. Under enforcement that flips, because a row nobody can read
    and anybody can overwrite is the worst of both.

    Both halves live in `may_act_on`, which is this function without the raise —
    ticket 33's two callers run in the scheduler and have no response to put a
    404 in. Stating the rule once is the point: two spellings of "is this row
    mine" is the drift the module exists to prevent, and they would diverge on
    the NULL branch first.

    `detail` carries the same requirement it does on `assert_owner`: the exact
    string this family answers for a row that is not there, so that "somebody
    else owns it" and "there is nothing here" stay indistinguishable.
    """
    if not may_act_on(owner_id=owner_id, user_id=user_id):
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
