"""Owner columns become NOT NULL with cascading keys (ticket 21, PR 3).

Revision ID: d2e3f4a5b6c7
Revises: c0d1e2f3a4b5
Create Date: 2026-08-30

Ticket 34 stamped every ownerless row the fourteen `USER_OWNED` tables held and
**deliberately left the columns nullable**, because the writers that produce
them were still there. PRs 1 and 2 of ticket 21 closed those writers. This
revision is what makes the property hold rather than merely being true right
now: the column stops permitting the state, and a foreign key makes the owner a
real account rather than a uuid nobody checks.

Two changes per table, and they answer different questions:

* **`NOT NULL`** — an unowned row is invisible to every account under
  enforcement, refused to every reader by id, unwritable, and swept by no
  retention window. Ticket 34's backfill was a snapshot against a schema that
  still allowed the thing it corrected.
* **`ON DELETE CASCADE` to `"user"(id)`** — ticket 21's own checkbox: deleting
  an account takes its rows with it while shared Channels and Posts survive.
  Without the key a deleted account leaves orphan stamps behind, which
  `audit_tenancy_drift.py` counts because they are a real state that nothing
  ever noticed. Under enforcement an orphan owner hides a row exactly as
  completely as no owner at all.

## It takes exclusive locks, and the usual trick cannot help here

`ALTER TABLE ... SET NOT NULL` takes `ACCESS EXCLUSIVE` and scans the whole
table while holding it. The textbook way around that is `ADD CONSTRAINT ...
CHECK ... NOT VALID`, then `VALIDATE CONSTRAINT` under `SHARE UPDATE EXCLUSIVE`,
then `SET NOT NULL`, which PostgreSQL 12+ satisfies from the validated check
without a second scan.

**That recipe was written here first and then removed, because it does not work
inside a migration.** `env.py` wraps `context.run_migrations()` in a single
`context.begin_transaction()`, and PostgreSQL holds every table lock until the
transaction commits. So the `ACCESS EXCLUSIVE` from step 1 is still held during
step 2's scan — the validation gains nothing — and the revision ends with all
fourteen tables plus `"user"` exclusively locked at once regardless. The dance
bought one extra full scan per table and a docstring that was not true.

What this revision actually does is the plain statement, and the honest summary
is: **it briefly blocks writes to fourteen tables, and the deploy is where that
lands.** `prestart.sh` runs it while the previous containers are still serving.
Measured on staging before this shipped, the largest of the fourteen is
`tg_network_logs` at ~90k rows / 138 MB, so the scans are milliseconds and the
outage is not one. If that stops being true — network logs are the family that
grows per scraped page — the fix is not a cleverer statement inside one
transaction but an out-of-band step: the recipe above run by hand, each phase
committed, before the deploy that adds the column constraint.

Foreign keys are added plainly for the same reason. `NOT VALID` plus
`VALIDATE CONSTRAINT` is the same shape and buys the same nothing here.

## Refusing is better than a half-applied schema

Every unowned or orphaned row has to be settled *before* step 1, and there are
three ways a row can be unowned. All three are handled, and anything left over
stops the deploy with the table and the count named — `prestart.sh` runs under
`set -e` with backend and worker gated on `service_completed_successfully`, so a
refusal here is loud and nothing starts against a schema that half-applied.

**The fresh-install path is the one that must not refuse.** `prestart.sh` runs
`alembic upgrade head` *before* `init_db` creates the first superuser, so on a
brand-new database there is no account to adopt anything to — and
`l4m5n6o7p8q9` and `n6o7p8q9r0s1` have already seeded the built-in setting-group
presets into the "global" scope with `user_id IS NULL`. Ticket 34 met exactly
this and left those rows for this revision, which is the only reason it can
delete them: nothing references them (a fresh database has no channels and no
follows, and this checks rather than assuming), and `init_db` gives the operator
its own copies through `ensure_builtin_groups` moments later. Ticket 34's first
cut raised on this path and broke `alembic upgrade head` from empty; that is
recorded here because the same mistake is available to this revision.

## The list is frozen, and the guard derives one

Copied from `c0d1e2f3a4b5` rather than imported from
`tenancy.owner_backfill_inventory()`, for the reason that revision states: an
applied revision must keep meaning what it meant, so reading live app code makes
it drift and breaks `upgrade head` from empty the first time somebody renames
the function. The derivation lives in the guard, where a forgotten table is a
red test rather than a column that silently stays nullable.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "d2e3f4a5b6c7"
down_revision = "c0d1e2f3a4b5"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")

#: The fourteen `USER_OWNED` tables with a nullable `user_id`, frozen at this
#: revision. Same list and same order as `c0d1e2f3a4b5`, so the two can be
#: compared directly by the guard.
OWNER_TABLES: tuple[str, ...] = (
    "tg_bot_credentials",
    "tg_channel_setting_groups",
    "tg_chat_destinations",
    "tg_chat_session_payloads",
    "tg_chat_sessions",
    "tg_discover_reports",
    "tg_embedding_logs",
    "tg_llm_logs",
    "tg_network_logs",
    "tg_publish_logs",
    "tg_summaries",
    "tg_summary_payloads",
    "tg_sync_jobs",
    "tg_tag_runs",
)

#: A payload row's owner is its parent's, never the operator's — the rule
#: `tenancy.OWNER_INHERITED_FROM` states and ticket 34's migration implements.
#: Repeated here because a row created between the two revisions has the same
#: question to answer, and stamping it with the operator while its parent
#: belongs to somebody else produces a detail view whose body is gone.
PAYLOAD_PARENTS: tuple[tuple[str, str, str, str], ...] = (
    ("tg_summary_payloads", "tg_summaries", "summary_id", "id"),
    ("tg_chat_session_payloads", "tg_chat_sessions", "chat_session_id", "id"),
)

#: The table whose unowned rows cannot simply be stamped, and the columns that
#: point at it. `tg_channel_setting_groups` carries the only non-key unique
#: index on any of the fourteen — `(COALESCE(user_id::text, 'global'),
#: lower(name))` — so `SET user_id = <operator>` raises `UniqueViolation` the
#: moment the operator already owns a same-named group.
_GROUPS = "tg_channel_setting_groups"
_GROUP_REFERENCES: tuple[tuple[str, str], ...] = (
    ("tg_channels", "setting_group_id"),
    ("tg_channel_follows", "setting_group_id"),
)

#: "Nobody who exists owns this row." NULL and an id left behind by a deleted
#: account are the same situation — `resolve_follow_owner`'s rule, and the one
#: ticket 34 used. The foreign key added below makes the second half
#: impossible from here on, which is the point of adding it.
_UNOWNED = 'user_id IS NULL OR user_id NOT IN (SELECT id FROM "user")'


def _unowned(alias: str = "") -> str:
    """`_UNOWNED`, qualified for a statement that joins another table.

    The bare predicate is ambiguous inside `_inherit_from_parents`' joined
    `UPDATE`, where both `child` and `parent` have a `user_id` — PostgreSQL
    rejects it rather than picking one, which is the good outcome and is how
    this was caught on the first run against an empty database.
    """
    prefix = f"{alias}." if alias else ""
    return (
        f'{prefix}user_id IS NULL OR {prefix}user_id NOT IN (SELECT id FROM "user")'
    )


def _bootstrap_owner(bind: sa.engine.Connection) -> Any:
    """The account legacy rows belong to on a single-operator install.

    **Byte-for-byte ticket 34's resolver**, which is byte-for-byte ticket 30's,
    for the reason ticket 04 gives: a second spelling of "who is the operator"
    is drift that shows up as two tables disagreeing about the same legacy row.

    The environment read is the load-bearing part, and the first draft of this
    revision got it wrong by importing `app.core.config` instead — which is a
    different answer, not a tidier one. Running the two revisions back to back
    on a copy of the dev database logged **two different operator ids**, because
    `FIRST_SUPERUSER` is in `.env` and reaches the settings object without ever
    being exported, so ticket 34 fell through to "oldest superuser" while this
    one matched by email. Exactly the failure both docstrings warn about,
    reproduced by the migration that was quoting the warning.
    """
    email = os.environ.get("FIRST_SUPERUSER")
    if email:
        found = bind.execute(
            sa.text('SELECT id FROM "user" WHERE email = :email').bindparams(
                email=email
            )
        ).first()
        if found is not None:
            return found[0]

    found = bind.execute(
        sa.text(
            'SELECT id FROM "user" WHERE is_superuser IS TRUE ORDER BY id LIMIT 1'
        )
    ).first()
    return found[0] if found is not None else None


def _any_accounts(bind: sa.engine.Connection) -> bool:
    return bind.execute(sa.text('SELECT 1 FROM "user" LIMIT 1')).first() is not None


def _unowned_counts(bind: sa.engine.Connection) -> dict[str, int]:
    """Rows per table that no live account owns, for the refusal message."""
    counts: dict[str, int] = {}
    for table in OWNER_TABLES:
        found = bind.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE {_UNOWNED}")  # noqa: S608
        ).scalar_one()
        if found:
            counts[table] = int(found)
    return counts


def _inherit_from_parents(bind: sa.engine.Connection) -> int:
    """Give every payload row its parent's owner. Runs **before** any adoption.

    The order matters and is invisible on a single-account database, because
    there the parent's owner *is* the operator. Only a second account separates
    them, which is why ticket 34's guard has to seed one.
    """
    total = 0
    for table, parent, child_key, parent_key in PAYLOAD_PARENTS:
        result = bind.execute(
            sa.text(
                f"UPDATE {table} AS child SET user_id = parent.user_id "  # noqa: S608
                f"FROM {parent} AS parent "
                f"WHERE child.{child_key} = parent.{parent_key} "
                f"AND parent.user_id IS NOT NULL "
                f"AND ({_unowned('child')})"
            )
        )
        total += result.rowcount or 0
    return total


def _reconcile_setting_groups(bind: sa.engine.Connection, owner: Any) -> tuple[int, int]:
    """Adopt unowned setting groups, merging any the operator already has.

    Ticket 34's `_reconcile_setting_groups`, repeated because a group created
    between the two revisions has the same problem, and because this revision
    adds `NOT NULL` — so a `UniqueViolation` here does not merely leave a row
    unstamped, it aborts the whole migration and stops the deploy.

    Row by row rather than as a set, and that is what makes it total: two
    deleted accounts that each had a "default" would collide with *each other*
    one step after adoption.
    """
    unowned = bind.execute(
        sa.text(
            f"SELECT id, name FROM {_GROUPS} WHERE {_UNOWNED} ORDER BY id"  # noqa: S608
        )
    ).all()

    merged = 0
    adopted = 0
    for group_id, name in unowned:
        target = bind.execute(
            sa.text(
                f"SELECT id FROM {_GROUPS} "  # noqa: S608
                "WHERE user_id = :owner AND lower(name) = lower(:name) "
                "AND id <> :group_id"
            ).bindparams(sa.bindparam("owner", value=owner), name=name, group_id=group_id)
        ).first()

        if target is None:
            bind.execute(
                sa.text(
                    f"UPDATE {_GROUPS} SET user_id = :owner WHERE id = :group_id"  # noqa: S608
                ).bindparams(sa.bindparam("owner", value=owner), group_id=group_id)
            )
            adopted += 1
            continue

        for table, column in _GROUP_REFERENCES:
            bind.execute(
                sa.text(
                    f"UPDATE {table} SET {column} = :target WHERE {column} = :group_id"  # noqa: S608
                ).bindparams(target=target[0], group_id=group_id)
            )
        bind.execute(
            sa.text(f"DELETE FROM {_GROUPS} WHERE id = :group_id").bindparams(  # noqa: S608
                group_id=group_id
            )
        )
        merged += 1

    return merged, adopted


def _adopt_to_operator(bind: sa.engine.Connection, owner: Any) -> int:
    """Stamp every remaining unowned row with the operator.

    `tg_channel_setting_groups` is excluded: it went through
    `_reconcile_setting_groups` above, which is the only way to satisfy its
    unique index.
    """
    total = 0
    for table in OWNER_TABLES:
        if table == _GROUPS:
            continue
        result = bind.execute(
            sa.text(
                f"UPDATE {table} SET user_id = :owner WHERE {_UNOWNED}"  # noqa: S608
            ).bindparams(sa.bindparam("owner", value=owner))
        )
        total += result.rowcount or 0
    return total


def _drop_unreferenced_global_groups(bind: sa.engine.Connection) -> int:
    """The fresh-install path: presets seeded before any account existed.

    Only reachable when the database holds **no accounts at all**, which on this
    project means `prestart.sh` is part-way through a first deploy —
    `alembic upgrade head` runs before `init_db` creates the first superuser, and
    `l4m5n6o7p8q9`/`n6o7p8q9r0s1` seed the built-in presets into the "global"
    scope when they find no user to attach them to.

    Deleting them is safe in the only way it can happen, and the safety is
    **checked rather than assumed**: a row is dropped only if no `tg_channels`
    or `tg_channel_follows` row points at it. `init_db` creates the operator's
    own copies through `ensure_builtin_groups` immediately afterwards, so
    nothing is lost. Anything still referenced is left alone and the caller
    refuses, which is the honest answer for a database that has data but no
    account to attribute it to.
    """
    referenced = " OR ".join(
        f"EXISTS (SELECT 1 FROM {table} r WHERE r.{column} = g.id)"
        for table, column in _GROUP_REFERENCES
    )
    result = bind.execute(
        sa.text(
            f"DELETE FROM {_GROUPS} AS g "  # noqa: S608
            f"WHERE ({_unowned('g')}) AND NOT ({referenced})"
        )
    )
    return result.rowcount or 0


def _set_not_null(bind: sa.engine.Connection, table: str) -> None:
    """The plain statement, for the reason the module docstring gives.

    This was the `CHECK ... NOT VALID` / `VALIDATE` / `SET NOT NULL` recipe, and
    it is one line now because alembic runs the whole revision in one
    transaction — so the `ACCESS EXCLUSIVE` taken by the first step was still
    held during the second step's scan and the validation relieved nothing. It
    cost one extra full scan of every table to arrive at the same lock profile.
    """
    bind.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN user_id SET NOT NULL"))


def _add_owner_fk(bind: sa.engine.Connection, table: str) -> None:
    """A real cascading key to `"user"(id)`.

    Added plainly rather than `NOT VALID` then `VALIDATE`, for the reason
    `_set_not_null` gives: one transaction wraps the revision, so the second
    statement scans under a lock the first one already holds.

    **`ON DELETE CASCADE` is why `release_groups_of_deleted_account` exists.**
    Deleting an account now takes its setting groups with it, and the two
    columns that name a group by id — `tg_channels.setting_group_id` and
    `tg_channel_follows.setting_group_id` — are plain strings with no key of
    their own. `_GROUP_REFERENCES` repoints them here; the service does the same
    at runtime, on both account-delete routes.

    Idempotent because a partial upgrade can be retried and this revision is
    the last one: `pg_constraint` is the only reliable way to ask.
    """
    constraint = f"fk_{table}_user_id_user"
    exists = bind.execute(
        sa.text("SELECT 1 FROM pg_constraint WHERE conname = :name").bindparams(
            name=constraint
        )
    ).first()
    if exists is not None:
        return
    bind.execute(
        sa.text(
            f"ALTER TABLE {table} ADD CONSTRAINT {constraint} "
            f'FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE'
        )
    )


def upgrade() -> None:
    bind = op.get_bind()

    inherited = _inherit_from_parents(bind)
    owner = _bootstrap_owner(bind)

    merged = adopted = 0
    dropped = 0
    if owner is not None:
        merged, adopted_groups = _reconcile_setting_groups(bind, owner)
        adopted = _adopt_to_operator(bind, owner) + adopted_groups
    elif not _any_accounts(bind):
        # Fresh install. See `_drop_unreferenced_global_groups`.
        dropped = _drop_unreferenced_global_groups(bind)

    remaining = _unowned_counts(bind)
    if remaining:
        if owner is None and _any_accounts(bind):
            msg = (
                "ticket 21: this deployment has accounts but no resolvable "
                "superuser, so there is nobody to adopt these rows to: "
                f"{remaining}. Set FIRST_SUPERUSER to an existing account, or "
                "mark one account is_superuser, then deploy again. Refusing "
                "rather than guessing — these rows may be somebody's content."
            )
        else:
            msg = (
                "ticket 21: rows with no owner remain and the columns cannot be "
                f"made NOT NULL: {remaining}. Every writer was closed in PRs 1 "
                "and 2, so this is either a table nobody reconciled or a "
                "setting group something still references."
            )
        raise RuntimeError(msg)

    for table in OWNER_TABLES:
        _set_not_null(bind, table)
        _add_owner_fk(bind, table)

    logger.info(
        "ticket 21: %d payload row(s) inherited an owner, %d adopted by the "
        "operator (%s), %d duplicate setting group(s) merged, %d unreferenced "
        "global preset(s) dropped on a fresh install; %d tables now NOT NULL "
        "with cascading keys",
        inherited,
        adopted,
        owner,
        merged,
        dropped,
        len(OWNER_TABLES),
    )


def downgrade() -> None:
    bind = op.get_bind()
    for table in OWNER_TABLES:
        constraint = f"fk_{table}_user_id_user"
        bind.execute(
            sa.text(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}")
        )
        bind.execute(sa.text(f"ALTER TABLE {table} ALTER COLUMN user_id DROP NOT NULL"))
