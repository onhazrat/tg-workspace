"""Give every user-owned row a real owner (ticket 34)

The tenancy seam ships disabled. The moment ticket 21 turns enforcement on, a
`USER_OWNED` row whose `user_id` is NULL becomes invisible to every account and
unwritable by every caller — `scoped_select` filters it out, `assert_owner`
answers 404 for it, and `may_act_on` refuses it. Three tickets reached that
conclusion from three directions and each left the fix here rather than
widening its own scope:

* **Ticket 31** — an import is one transaction, so the *first* ownerless row
  aborts a whole restore. A backup taken before the stamp existed stops
  restoring entirely.
* **Ticket 32** — an ownerless credential is visible today and invisible after
  the flip. Matching NULL as "mine" was refused because it would hand every
  account the deployment's stored bot token.
* **Ticket 33** — a NULL on either side of the auto-publish check is
  unanswerable, and `run_auto_summary` deliberately picks up ownerless
  Summaries today.

## Why a migration and not the script that already exists

`backend/scripts/backfill_user_id.py` is idempotent and is not the answer.
**Nothing runs it** — `prestart.sh` runs `alembic upgrade head` and nothing
else, so a deployment that never ran the script by hand would flip the flag
with ownerless rows in place. Its table list also predates the seam: it covers
thirteen models chosen before `SCOPES` existed, five of which (`Channel`,
`Post`, `PostEmbedding`, `PostTranslation`, `SyncLog`) are now follow-scoped or
corpus, whose `user_id` ticket 22 *drops*, and it misses ten `USER_OWNED`
tables added since. It survives only because `scripts/cleanup_test_channels.py`
shells out to its `--reassign-all` mode; it is not what makes the flip
survivable.

## The inventory is frozen here and derived in the guard

`BACKFILL_TABLES` below is a literal, and `services/tenancy.py`'s
`owner_backfill_inventory()` derives the same list from `SCOPES`.
`tests/services/test_owner_backfill.py` asserts they agree, so a `USER_OWNED`
table added later with a nullable owner turns into a failing test that asks for
its own migration.

The obvious alternative — import the derivation and call it from `upgrade()` —
is worse in both directions. A migration must mean the same thing on every
database for ever, and one that reads live app code changes meaning as the app
moves and breaks `alembic upgrade head` from an empty database the first time
somebody renames the function. It would not even help the case the ticket cares
about: a table added after this revision has already run is not reached by
re-deriving anything, it needs a revision of its own.

## A payload row inherits; it is not adopted

`tg_summary_payloads` and `tg_chat_session_payloads` take **their parent's**
owner. A payload is reachable only through the `Summary` or `ChatSession` that
names it, so stamping it with the deployment operator while its parent belongs
to another account produces a row that is invisible to the one account that can
reach it — a detail view whose body is gone while the parent is still listed.
The inheritance pass therefore runs *before* the operator pass; the other order
compiles, runs, and is wrong only when a second account exists.

## One table is reconciled, not stamped

`tg_channel_setting_groups` carries a unique index on
`(COALESCE(user_id::text, 'global'), lower(name))`, and it is the only non-key
unique index on any of the fourteen. Every database ever migrated from empty
holds global-scope presets, the operator holds identically-named copies, and
setting the global rows' owner to the operator makes both halves of that key
equal — so the plain `UPDATE` raises `UniqueViolation`, and since all the
statements share one transaction the revision fails and `prestart.sh` stops the
deploy. The first cut shipped exactly that; review found it and it reproduces
in three statements.

So those rows are reconciled one at a time: merged into the operator's
same-named group, with `tg_channels` and `tg_channel_follows` repointed first,
or adopted when the operator has no counterpart. See
`_reconcile_setting_groups`.

## Who the operator is

`FIRST_SUPERUSER`, then the oldest superuser — the rule
`follows.resolve_follow_owner` states and tickets 06, 20 and 30 all resolve the
same way, so a fifth answer here would be the drift
`scripts/audit_tenancy_drift.py` exists to report. An id left behind by a
deleted account is treated exactly like NULL: the TG tables have no foreign key
to `user.id`, so orphan stamps are a real state, and under enforcement an
orphan owner hides a row just as completely as no owner at all.

## It completes in one pass

Alembic stamps a revision and never re-runs it, so a migration that leaves work
"for the next deploy" leaves it undone for ever. (Ticket 06's migration claims
otherwise in its own docstring; that claim is wrong and is not copied here.)

The one case that cannot be finished is a database with **no account to adopt
to**, and it is two situations wearing the same clothes. `_bootstrap_owner`
returns nothing either way, so this asks the follow-up question — are there any
accounts at all? — and answers them differently:

* **No accounts exist.** This is a fresh install. `prestart.sh` runs `alembic
  upgrade head` *before* `init_db` creates the first superuser, so the only
  rows here are the ones earlier migrations wrote on the way past: the
  `tg_channel_setting_groups` presets that `l4m5n6o7p8q9` and `n6o7p8q9r0s1`
  seed into the "global" scope when they find no user to attach them to. They
  are the only unowned rows a database can hold before a person has touched it
  — no other migration inserts into a table in this inventory except by copying
  rows that already had an owner. Nobody exists yet for enforcement to hide
  them from, and `init_db` gives the operator its own copies through
  `ensure_builtin_groups`. So this completes and logs what it left, rather than
  refusing every first deploy the project will ever have. **The first version
  of this migration raised here, and it broke `alembic upgrade head` on an
  empty database** — the guard caught it on its first run, which is the entire
  argument for seeding one row per table in the test rather than trusting the
  shape of the `UPDATE`.

  **This is the one path that leaves the invariant unmet, and it is handed to
  ticket 21 rather than papered over.** An earlier draft of this docstring
  claimed no Channel could reference a global preset "because every creation
  path resolves the group for a real user". That is false, and review caught
  it: `channels.py` and `followed_channels.py` both call
  `ensure_default_group(session, user_id=user_id)` with a `uuid.UUID | None`,
  and `sync_orchestrator`'s auto-follow passes `user_id or channel.user_id`,
  either of which can be `None` and resolve to `default-global`. So the residue
  is reachable. It belongs with the other precondition this migration cannot
  close — the log `upsert_*` calls and the scheduler's `SyncJob` rows that keep
  writing unowned rows every day — and ticket 21 has to eliminate the
  `user_id=None` creation paths before it flips the flag either way.
* **Accounts exist and none of them can be resolved as the operator.**
  `FIRST_SUPERUSER` names nobody and no row has `is_superuser` set. Somebody has
  used this deployment, so the unowned rows may be their content, and passing
  over it leaves rows that vanish the day the flag flips with no second chance
  from alembic. This stops the deploy and names the tables and counts. It does
  **not** delete: these are summaries, chats, credentials and destinations, not
  the provably-empty dismissal table ticket 30 reasoned about.

## Two consequences worth stating rather than discovering

**Stamping a log row moves it between retention windows.** `jobs/retention.py`
sweeps unowned rows of the personal log families on the deployment's
`sharedLogRetentionDays` and owned ones on their owner's `logRetentionDays`, so
the existing backlog of publish, LLM and embedding logs moves from the first
sweep to the second. Both default to 30, which makes it neutral out of the box;
an operator who disabled `logRetentionDays` while leaving the shared window in
place gets rows that were being pruned yesterday and are retained from now on.
That is the correct destination for a row that now has an owner, and it is not
silent — it is here.

**It is one transaction, and it rewrites every row it touches.** Sixteen
unbounded statements, so on a deployment with large `tg_network_logs` or
`tg_llm_logs` the deploy is held open for the rewrite and the heap roughly
doubles through MVCC until the next vacuum. Batching with periodic commits
would shorten the lock and give up atomicity, which is the wrong trade for a
migration whose partial application is exactly the half-owned state ticket 21
cannot flip on. Measured on the development database it stamps **zero** rows,
because everything there already has a live owner.

## Not in scope

The columns stay nullable. Making them `NOT NULL` would reject the writes that
still legitimately produce unowned rows today — every log `upsert_*` takes
`user_id` as optional and the scheduler creates `SyncJob` rows with none — so
it would trade a data gap for an outage. Closing those writers, and dropping
the superseded columns, are ticket 21's and ticket 22's.

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-08-28
"""

import logging
import os
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "c0d1e2f3a4b5"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")

#: `(table, parent_table, child_key, parent_key)` for every `USER_OWNED` table
#: with a nullable `user_id`, frozen at this revision. A parent means the row
#: inherits its owner rather than being adopted by the operator.
#:
#: Kept in the shape of `tenancy.OwnerBackfill` so the guard can compare the
#: two directly. Sorted by table name, which is the order the derivation
#: returns — a set comparison would pass while the two disagreed about a
#: parent link, which is the half that has a wrong answer available to it.
BACKFILL_TABLES: tuple[tuple[str, str | None, str | None, str | None], ...] = (
    ("tg_bot_credentials", None, None, None),
    ("tg_channel_setting_groups", None, None, None),
    ("tg_chat_destinations", None, None, None),
    ("tg_chat_session_payloads", "tg_chat_sessions", "chat_session_id", "id"),
    ("tg_chat_sessions", None, None, None),
    ("tg_discover_reports", None, None, None),
    ("tg_embedding_logs", None, None, None),
    ("tg_llm_logs", None, None, None),
    ("tg_network_logs", None, None, None),
    ("tg_publish_logs", None, None, None),
    ("tg_summaries", None, None, None),
    ("tg_summary_payloads", "tg_summaries", "summary_id", "id"),
    ("tg_sync_jobs", None, None, None),
    ("tg_tag_runs", None, None, None),
)

#: "Nobody who exists owns this row." NULL and an id left behind by a deleted
#: account are the same situation, so they get the same answer rather than one
#: being a fallback and the other a crash — `resolve_follow_owner`'s rule.
_UNOWNED = 'user_id IS NULL OR user_id NOT IN (SELECT id FROM "user")'

#: The one table where stamping the owner can violate a constraint, so it is
#: reconciled row by row instead of swept by `_adopt_to_operator`.
#:
#: `n6o7p8q9r0s1` put a unique index on
#: `(COALESCE(user_id::text, 'global'), lower(name))`, and it is the **only**
#: non-primary-key unique index on any of the fourteen tables — checked, not
#: assumed, and `test_owner_backfill.py` re-checks it so a new one cannot arrive
#: unnoticed. Every database ever migrated from empty carries global-scope
#: presets named `default`, `Slow feed`, `High velocity`, `Frozen` and
#: `Restricted`, because `l4m5n6o7p8q9` and `n6o7p8q9r0s1` both fall back to
#: `scopes = [(None,)]` when they find no user. The operator then gets
#: identically-named copies from `ensure_builtin_groups`. Setting the global
#: rows' owner to the operator makes both the scope key and the name equal, the
#: index rejects it, and since all the updates share one transaction the whole
#: revision fails and `prestart.sh` stops the deploy.
#:
#: This was found by review after the first cut shipped the plain `UPDATE`, and
#: it is reproducible in three statements. The guard now seeds the collision.
_RECONCILED_TABLE = "tg_channel_setting_groups"

#: Columns pointing at a setting group, so a merged row's referrers move with
#: it. `tg_channel_follows` did not exist when `m5n6o7p8q9r0` merged duplicate
#: groups the same way, which is why that migration repoints only channels —
#: copying it verbatim would strand every follow on a deleted group.
_SETTING_GROUP_REFERENCES = (
    ("tg_channels", "setting_group_id"),
    ("tg_channel_follows", "setting_group_id"),
)


def upgrade() -> None:
    bind = op.get_bind()
    backfill_owners(bind)


def backfill_owners(bind: sa.engine.Connection) -> None:
    """Stamp every ownerless user-owned row, or refuse and say why.

    Separate from `upgrade()` so the guard can run it against a seeded database
    without driving alembic. `upgrade()` is then two lines and holds no logic
    of its own, which is the only way a migration's behaviour gets tested here
    at all.
    """
    inherited = _inherit_payload_owners(bind)

    owner = _bootstrap_owner(bind)
    if owner is None:
        _finish_without_an_account(bind)
        return

    merged, adopted_groups = _reconcile_setting_groups(bind, owner)
    adopted = _adopt_to_operator(bind, owner) + adopted_groups

    logger.info(
        "ticket 34: stamped %d row(s) — %d inherited from a parent, %d adopted "
        "by the operator (%s); %d duplicate setting group(s) merged into the "
        "operator's own",
        inherited + adopted,
        inherited,
        adopted,
        owner,
        merged,
    )


def _inherit_payload_owners(bind: sa.engine.Connection) -> int:
    """Give each payload row the owner of the row it belongs to.

    Runs before the operator pass, and that order is the whole point: a payload
    adopted by the operator while its parent belongs to another account is
    unreachable by the only account that can see its parent.

    A payload whose parent is *itself* unowned is left for the operator pass,
    where parent and child end up with the same id anyway. A payload whose
    parent row is missing entirely falls there too — an orphan body with no
    detail view to read it through, which the operator inherits along with the
    rest of the deployment's history.
    """
    stamped = 0
    for table, parent, child_key, parent_key in BACKFILL_TABLES:
        if parent is None:
            continue
        result = bind.execute(
            sa.text(
                f"UPDATE {table} AS child SET user_id = parent.user_id "  # noqa: S608
                f"FROM {parent} AS parent "
                f"WHERE parent.{parent_key} = child.{child_key} "
                "AND parent.user_id IS NOT NULL "
                'AND parent.user_id IN (SELECT id FROM "user") '
                "AND (child.user_id IS NULL "
                'OR child.user_id NOT IN (SELECT id FROM "user"))'
            )
        )
        stamped += result.rowcount or 0
    return stamped


def _reconcile_setting_groups(
    bind: sa.engine.Connection, owner: Any
) -> tuple[int, int]:
    """Adopt unowned setting groups, merging the ones the operator already has.

    See `_RECONCILED_TABLE` for why this table cannot take the blanket
    `UPDATE`: the scope-name unique index rejects it, and one rejection fails
    the whole revision and stops the deploy.

    Merging rather than renaming, because the two rows *are* the same built-in
    preset — one seeded into the global scope before an account existed, one
    created for the operator by `ensure_builtin_groups` afterwards. Renaming
    would leave the operator looking at "default" and "default (2)" and having
    to work out which is which. `m5n6o7p8q9r0` already merged duplicate groups
    this way, so this follows a path the schema has been down before.

    Row by row rather than as one statement, and that is what makes it total: a
    second unowned row with the same name — two deleted accounts that each had
    a "default" — finds the row the first pass adopted and merges into it.
    Handled as a set operation, those two would collide with *each other* after
    adoption, which is the same failure one step further along.
    """
    unowned = bind.execute(
        sa.text(
            f"SELECT id, name FROM {_RECONCILED_TABLE} "  # noqa: S608
            f"WHERE {_UNOWNED} ORDER BY id"
        )
    ).all()

    merged = 0
    adopted = 0
    for group_id, name in unowned:
        target = bind.execute(
            sa.text(
                f"SELECT id FROM {_RECONCILED_TABLE} "  # noqa: S608
                "WHERE user_id = :owner AND lower(name) = lower(:name) "
                "AND id <> :group_id"
            ).bindparams(
                sa.bindparam("owner", value=owner), name=name, group_id=group_id
            )
        ).first()

        if target is None:
            bind.execute(
                sa.text(
                    f"UPDATE {_RECONCILED_TABLE} "  # noqa: S608
                    "SET user_id = :owner WHERE id = :group_id"
                ).bindparams(sa.bindparam("owner", value=owner), group_id=group_id)
            )
            adopted += 1
            continue

        for table, column in _SETTING_GROUP_REFERENCES:
            bind.execute(
                sa.text(
                    f"UPDATE {table} SET {column} = :target "  # noqa: S608
                    f"WHERE {column} = :group_id"
                ).bindparams(target=target[0], group_id=group_id)
            )
        bind.execute(
            sa.text(
                f"DELETE FROM {_RECONCILED_TABLE} WHERE id = :group_id"  # noqa: S608
            ).bindparams(group_id=group_id)
        )
        merged += 1

    return merged, adopted


def _adopt_to_operator(bind: sa.engine.Connection, owner: Any) -> int:
    """Give every remaining unowned row to the operator.

    Skips `_RECONCILED_TABLE`, which `_reconcile_setting_groups` has already
    finished — running both over it would be harmless today and is skipped
    anyway, because two functions writing one table is how they end up
    disagreeing about it.
    """
    stamped = 0
    for table, *_ in BACKFILL_TABLES:
        if table == _RECONCILED_TABLE:
            continue
        result = bind.execute(
            sa.text(
                f"UPDATE {table} SET user_id = :owner WHERE {_UNOWNED}"  # noqa: S608
            ).bindparams(sa.bindparam("owner", value=owner))
        )
        stamped += result.rowcount or 0
    return stamped


def _finish_without_an_account(bind: sa.engine.Connection) -> None:
    """No operator resolved. Say what was left, and refuse only when it matters.

    Two different databases arrive here and they need different answers, so the
    follow-up question is asked rather than assumed. See the module docstring
    for the full argument; in short, a database with **no accounts at all** is a
    fresh install whose only unowned rows were written minutes earlier by the
    setting-group migrations, while a database with accounts and no superuser
    has been used by somebody and its unowned rows may be their content.
    """
    counts = {}
    for table, *_ in BACKFILL_TABLES:
        remaining = bind.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE {_UNOWNED}")  # noqa: S608
        ).scalar_one()
        if remaining:
            counts[table] = remaining

    if not counts:
        logger.info(
            "ticket 34: no account exists yet and no unowned rows to adopt — "
            "nothing to do."
        )
        return

    listed = ", ".join(f"{table}={count}" for table, count in sorted(counts.items()))
    accounts = _account_count(bind)

    if not accounts:
        # A fresh install, mid-bootstrap. Loud rather than silent: this is the
        # one path that leaves the invariant unmet, and alembic will not run
        # this revision again to finish it.
        logger.warning(
            "ticket 34: no account exists yet, so %d row(s) keep no owner "
            "(%s). These are the built-in setting-group presets the earlier "
            "migrations seed into the global scope before a superuser exists; "
            "init_db gives the operator its own copies and nothing references "
            "these. If you see a table other than tg_channel_setting_groups "
            "here, that is a database this migration did not anticipate.",
            sum(counts.values()),
            listed,
        )
        return

    raise RuntimeError(
        f"{sum(counts.values())} user-owned row(s) have no owner, and none of "
        f"the {accounts} account(s) on this deployment can be resolved as the "
        f"operator ({listed}). `FIRST_SUPERUSER` names no user and no row in "
        '"user" has is_superuser set. Under enforcement these rows would '
        "be invisible to every account and refused to every writer, and alembic "
        "will not run this revision again — so this migration will not guess an "
        "owner and will not delete them. Set FIRST_SUPERUSER to an existing "
        "address, or restore a superuser, then deploy again."
    )


def _account_count(bind: sa.engine.Connection) -> int:
    """How many accounts exist at all — the question that splits the two cases.

    Its own function so the guard can put the migration on a database with no
    accounts without needing a database that has none. The suite already covers
    the real thing from the other side: `tests/conftest.py` runs `alembic
    upgrade head` against an empty test database before any user is created, so
    a version of this that refuses a fresh install cannot get a green run. That
    is how the first cut of this migration was caught.
    """
    return int(bind.execute(sa.text('SELECT count(*) FROM "user"')).scalar_one())


def _bootstrap_owner(bind: sa.engine.Connection) -> Any:
    """The account legacy rows belong to on a single-operator install.

    `FIRST_SUPERUSER` first, matching `services/operator.get_operator_user_id`,
    then the oldest superuser as a fallback for a deployment whose bootstrap
    address has since been changed. Read from the environment rather than by
    importing `app.core.config`, because a migration must not depend on the
    running app's settings object. Byte-for-byte ticket 30's resolver, for the
    reason ticket 04 gives: a second spelling of "who is the operator" is drift
    that shows up as two tables disagreeing about the same legacy row.
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


def downgrade() -> None:
    """Nothing to undo.

    The owners this wrote are the answer to "whose row is this", not a value
    that replaced another one — every row it touched had NULL or an id naming
    no account. Setting them back would restore an ambiguity rather than a
    previous state, and would re-break the restore path ticket 31 pinned. The
    columns were nullable before this ran and still are, so the schema needs no
    reversal either.
    """
