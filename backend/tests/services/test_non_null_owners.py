"""Ticket 21, PR 3: the owner columns stop permitting a row nobody owns.

Ticket 34 stamped the rows that existed and left the columns nullable. PRs 1
and 2 closed the writers. This revision (`d2e3f4a5b6c7`) is what makes the
property hold rather than being true by coincidence: `NOT NULL` on all fourteen
`USER_OWNED` tables, plus a real `ON DELETE CASCADE` key to `"user"(id)` so an
owner is an account rather than a uuid nobody checks.

## What this file has to catch, and what ticket 34's guard could not

Ticket 34 shipped a migration that raised `UniqueViolation` on any database
where the operator already owned a setting group with the same name as an
unowned one — inside `alembic upgrade head`, which under `prestart.sh`'s `set
-e` stops the deploy rather than degrading. `/code-review` caught it after a
green suite and an open PR. **Its own guard structurally could not**: the
seeder invented a unique name per row, so the index was unreachable from the
test.

The general form is the part worth carrying, and it is why the collision test
below seeds a *colliding* name rather than a distinct one:

> A guard that exercises a statement's predicate says nothing about the
> constraints that statement has to satisfy.

## Two more things running the migration for real turned up

Neither was visible from reading it:

* **The joined `UPDATE` was ambiguous.** `_inherit_from_parents` joins child to
  parent and both have a `user_id`, so the unqualified predicate was rejected by
  PostgreSQL rather than silently picking one. Caught on the first run against
  an empty database.
* **The two migrations disagreed about who the operator is.** Ticket 34 reads
  `FIRST_SUPERUSER` from `os.environ`, deliberately — a migration must not
  depend on the running app's settings object. This revision's first draft
  imported `app.core.config` instead, and on a copy of the dev database the two
  logged **different operator ids**, because the variable reaches the settings
  object from `.env` without ever being exported. That is precisely the drift
  both docstrings warn about, committed by the revision quoting the warning.
"""

from __future__ import annotations

import ast
import uuid

import pytest
import sqlalchemy as sa
from sqlmodel import Session, select

from app.alembic.versions import (  # ty: ignore[unresolved-import]
    d2e3f4a5b6c7_non_null_owners_ticket_21 as migration,
)
from app.core.db import engine
from app.models_tg import ChannelSettingGroup
from app.services.tenancy import owner_backfill_inventory

#: The tables the migration froze, and the ones the seam derives today.
FROZEN = set(migration.OWNER_TABLES)


def test_the_frozen_list_is_the_one_scopes_derives() -> None:
    """The migration's copy and `SCOPES` must name the same fourteen tables.

    The migration deliberately *freezes* its list rather than calling
    `owner_backfill_inventory()` — an applied revision has to keep meaning what
    it meant, and importing live app code makes it drift the first time somebody
    renames a function. So the derivation lives here, where a `USER_OWNED` table
    added next month is a red test rather than a column that silently stays
    nullable and a row that vanishes on the flip.
    """
    derived = {entry.table for entry in owner_backfill_inventory()}
    assert FROZEN == derived, (
        f"the migration froze {sorted(FROZEN)} but SCOPES now derives "
        f"{sorted(derived)}. A new USER_OWNED table needs a migration of its "
        f"own — re-deriving cannot reach a table added after this one ran."
    )


def test_every_owner_column_is_not_null_with_a_cascading_key() -> None:
    """The schema, read back from the database rather than from the migration.

    Asserting on the revision's source would pass on a database the revision
    never reached. `tests/conftest.py` migrates the test database the same way a
    deployment does, so this is the applied schema.
    """
    missing_not_null: list[str] = []
    missing_fk: list[str] = []

    with Session(engine) as session:
        for table in sorted(FROZEN):
            nullable = session.exec(
                sa.text(  # ty: ignore[invalid-argument-type]
                    "SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = 'user_id'"
                ).bindparams(t=table)
            ).one()
            if nullable[0] != "NO":
                missing_not_null.append(table)

            # Matched on the **constrained column**, not on the constraint's
            # name. `LIKE '%user_id%'` was the first spelling and it was a
            # latent false pass: ticket 27 added `acted_by_user_id` to four of
            # these tables, whose key is deliberately `SET NULL`, and its name
            # matches that pattern too — so `.first()` returned whichever of the
            # two Postgres felt like, and the guard failed or passed at random
            # while the schema was entirely correct. A guard that reads a name
            # to find out about a column eventually finds the wrong one.
            fk = session.exec(
                sa.text(  # ty: ignore[invalid-argument-type]
                    "SELECT c.confdeltype FROM pg_constraint c "
                    "JOIN pg_class t ON t.oid = c.conrelid "
                    "JOIN pg_attribute a "
                    "  ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey) "
                    "WHERE t.relname = :t AND c.contype = 'f' "
                    "AND a.attname = 'user_id'"
                ).bindparams(t=table)
            ).first()
            # 'c' is ON DELETE CASCADE. A key that merely exists is not the
            # requirement: ticket 21's checkbox is that deleting an account
            # takes its rows with it, and RESTRICT would make deleting an
            # account fail instead.
            if fk is None or fk[0] != "c":
                missing_fk.append(table)

    assert not missing_not_null, (
        f"{missing_not_null} still allow a NULL owner. Under enforcement such a "
        f"row is invisible to every account and swept by no retention window."
    )
    assert not missing_fk, (
        f'{missing_fk} have no ON DELETE CASCADE key to "user"(id). Without '
        f"it a deleted account leaves orphan stamps, which hide a row exactly "
        f"as completely as no owner at all."
    )


def test_a_deleted_account_takes_its_rows_and_leaves_the_corpus() -> None:
    """Ticket 21's cascade checkbox, on real rows.

    Both halves matter and they pull in opposite directions: the account's own
    setting group must go, and the shared Channel must stay. A cascade added to
    the corpus tables by mistake would pass the first assertion and fail the
    second, which is the failure that would be hardest to notice — it deletes
    another account's data.
    """
    from app.models import User
    from app.models_tg import Channel
    from tests.utils.setting_groups import add_test_channel
    from tests.utils.user import create_random_user

    with Session(engine) as session:
        victim = create_random_user(session)
        add_test_channel(
            session, "cascade-ch", name="cascade-channel", user_id=victim.id
        )
        group_ids = {
            row.id
            for row in session.exec(
                select(ChannelSettingGroup).where(
                    ChannelSettingGroup.user_id == victim.id
                )
            ).all()
        }
        assert group_ids, "the account should own at least one setting group"

        session.delete(session.get(User, victim.id))
        session.commit()

        for group_id in group_ids:
            assert session.get(ChannelSettingGroup, group_id) is None, (
                "the account's setting group survived its owner; the cascade "
                "is missing or is RESTRICT"
            )
        assert session.get(Channel, "cascade-ch") is not None, (
            "the shared Channel was deleted with its follower. Channels are "
            "follow-scoped corpus — a second follower's scrape must survive "
            "the first follower's account being removed."
        )


def test_a_surviving_channel_still_resolves_its_group_after_its_scraper_leaves() -> (
    None
):
    """The other half of the cascade, and the half review found missing.

    A surviving Channel is not enough — it has to still *work*. Before ticket 22
    a follow copied its group id off the Channel, which auto-follow files under
    whoever scraped the handle first, so the second follower's row named the
    **first** follower's setting group. Ticket 21's cascading key then takes
    that group with the account and leaves the follow naming a group that is
    gone, so `schedule_group_id` resolves to nothing and auto-sync skips a
    channel B legitimately follows.

    Reachable by a plain user through `DELETE /users/me`, not only by an Admin,
    which is why `release_groups_of_deleted_account` runs on both delete paths.

    **Ticket 22 removed one of the two stranded rows and left the other.** The
    Channel names no group at all now, so it cannot be stranded and cannot need
    repointing; the follow still can, and still does. The scenario is therefore
    set up explicitly — a follow pointing at another account's group is the
    legacy state this repointing exists for, and it is no longer something a
    creation path will produce on its own.

    The two accounts are what make this test able to fail at all — with one
    account there is no survivor to strand, which is how the first version of
    the cascade guard passed on the broken outcome.
    """
    from app.models import User
    from app.models_tg import Channel, ChannelFollow
    from app.services.channel_setting_groups import (
        ensure_default_group,
        release_groups_of_deleted_account,
    )
    from app.services.follows import ensure_follow_for_channel
    from tests.utils.setting_groups import add_test_channel
    from tests.utils.user import create_random_user

    with Session(engine) as session:
        scraper = create_random_user(session)
        follower = create_random_user(session)

        channel = add_test_channel(
            session, "orphan-group-ch", name="orphan-group-ch", user_id=scraper.id
        )
        doomed_group = ensure_default_group(session, user_id=scraper.id).id
        # The second follower pointed at the scraper's group, exactly as a
        # pre-ticket-22 auto-follow left it.
        ensure_follow_for_channel(
            session,
            channel,
            user_id=follower.id,
            values={"setting_group_id": doomed_group},
        )
        session.commit()

        assert doomed_group.endswith(str(scraper.id))

        release_groups_of_deleted_account(session, scraper.id)
        session.delete(session.get(User, scraper.id))
        session.commit()

        session.expire_all()
        survivor = session.get(Channel, "orphan-group-ch")
        assert survivor is not None

        their_follow = session.exec(
            select(ChannelFollow).where(
                ChannelFollow.user_id == follower.id,
                ChannelFollow.channel_id == "orphan-group-ch",
            )
        ).one()
        assert their_follow.setting_group_id != doomed_group, (
            "the surviving follow still names the deleted account's group, so "
            "`schedule_group_id` resolves to nothing and auto-sync skips it"
        )
        # Not "is the id different" but "does it resolve" — the assertion that
        # would have caught the original bug.
        assert their_follow.setting_group_id is not None
        assert (
            session.get(ChannelSettingGroup, their_follow.setting_group_id) is not None
        )


def test_a_colliding_setting_group_is_merged_rather_than_stamped(
    legacy_owner_schema: None,
    legacy_channel_group_column: None,
) -> None:
    """The trap ticket 34 fell into, exercised against the constraint.

    `tg_channel_setting_groups` carries the only non-key unique index on any of
    the fourteen — `(COALESCE(user_id::text, 'global'), lower(name))` — so the
    obvious `SET user_id = <operator> WHERE user_id IS NULL` raises
    `UniqueViolation` the moment the operator already owns a group of the same
    name. Every database ever migrated from empty is in exactly that state.

    Seeded with a **colliding** name on purpose. Ticket 34's guard invented a
    unique name per row, which made the index structurally unreachable and let
    the bug through a green suite.
    """
    from tests.utils.user import create_random_user

    with Session(engine) as session:
        owner = create_random_user(session)
        mine = ChannelSettingGroup(
            id=f"grp-{uuid.uuid4().hex[:8]}",
            user_id=owner.id,
            name="Collides",
            is_default=False,
            regular_sync_enabled=True,
            dynamic_sync_enabled=False,
            auto_sync_interval_minutes=60,
            dynamic_sync_expected_posts=15,
            auto_follow_forwarded=False,
        )
        session.add(mine)
        session.commit()

        bind = session.connection()
        # The unowned twin the migration has to reconcile. Inserted with raw SQL
        # because the model's `user_id` is non-null since this ticket — the
        # state only a legacy database can be in, which is the state the
        # migration exists for.
        orphan_id = f"grp-{uuid.uuid4().hex[:8]}"
        bind.execute(
            sa.text(
                "INSERT INTO tg_channel_setting_groups "
                "(id, user_id, name, is_default, regular_sync_enabled, "
                " dynamic_sync_enabled, auto_sync_interval_minutes, "
                " dynamic_sync_expected_posts, auto_follow_forwarded, "
                " created_at, updated_at) "
                "VALUES (:id, NULL, :name, false, true, false, 60, 15, false, "
                " now(), now())"
            ).bindparams(id=orphan_id, name="collides")
        )

        merged, adopted = migration._reconcile_setting_groups(bind, owner.id)

        assert merged == 1, (
            "a same-named unowned group must be merged into the operator's, "
            "not stamped — stamping it makes both halves of the unique index "
            "equal and aborts the migration inside `alembic upgrade head`, "
            "which stops the deploy"
        )
        assert adopted == 0
        assert (
            bind.execute(
                sa.text(
                    "SELECT 1 FROM tg_channel_setting_groups WHERE id = :id"
                ).bindparams(id=orphan_id)
            ).first()
            is None
        )
        session.rollback()


def test_an_unowned_group_with_no_counterpart_is_adopted(
    legacy_owner_schema: None,
    legacy_channel_group_column: None,
) -> None:
    """The other branch: nothing to merge into, so the operator takes it.

    Without this, a reconciliation that merged everything and adopted nothing
    would pass the collision test above while silently deleting groups the
    operator did not already have.
    """
    from tests.utils.user import create_random_user

    with Session(engine) as session:
        owner = create_random_user(session)
        bind = session.connection()
        orphan_id = f"grp-{uuid.uuid4().hex[:8]}"
        unique_name = f"lonely-{uuid.uuid4().hex[:6]}"
        bind.execute(
            sa.text(
                "INSERT INTO tg_channel_setting_groups "
                "(id, user_id, name, is_default, regular_sync_enabled, "
                " dynamic_sync_enabled, auto_sync_interval_minutes, "
                " dynamic_sync_expected_posts, auto_follow_forwarded, "
                " created_at, updated_at) "
                "VALUES (:id, NULL, :name, false, true, false, 60, 15, false, "
                " now(), now())"
            ).bindparams(id=orphan_id, name=unique_name)
        )

        merged, adopted = migration._reconcile_setting_groups(bind, owner.id)

        assert merged == 0
        assert adopted == 1
        stamped = bind.execute(
            sa.text(
                "SELECT user_id FROM tg_channel_setting_groups WHERE id = :id"
            ).bindparams(id=orphan_id)
        ).one()
        assert stamped[0] == owner.id
        session.rollback()


def test_that_unique_index_is_still_the_only_one_of_its_kind() -> None:
    """Checked, not assumed — the reconciliation is written for exactly one table.

    If a second of the fourteen grows a non-key unique index touching
    `user_id`, the blanket `UPDATE` in `_adopt_to_operator` can hit the same
    `UniqueViolation` and stop a deploy, and nothing else would say so.
    """
    with Session(engine) as session:
        rows = session.exec(
            sa.text(  # ty: ignore[invalid-argument-type]
                "SELECT t.relname, i.relname FROM pg_index x "
                "JOIN pg_class t ON t.oid = x.indrelid "
                "JOIN pg_class i ON i.oid = x.indexrelid "
                "WHERE x.indisunique AND NOT x.indisprimary "
                "AND t.relname = ANY(:tables) "
                "AND pg_get_indexdef(i.oid) LIKE '%user_id%'"
            ).bindparams(tables=sorted(FROZEN))
        ).all()

    tables = {row[0] for row in rows}
    assert tables == {"tg_channel_setting_groups"}, (
        f"the set of tables carrying a non-key unique index over `user_id` "
        f"changed to {sorted(tables)}. `_reconcile_setting_groups` handles "
        f"exactly one; the rest go through a blanket UPDATE that a second such "
        f"index would abort, taking the deploy with it."
    )


@pytest.mark.parametrize("alias", ["", "child"])
def test_the_unowned_predicate_qualifies_its_columns(alias: str) -> None:
    """`_unowned` has to be usable inside a joined UPDATE.

    The bare form is ambiguous where both sides have a `user_id`, and PostgreSQL
    refuses it rather than choosing — which is how the first run against an
    empty database found it. Cheap to pin, and the failure it prevents costs a
    whole deploy.
    """
    predicate = migration._unowned(alias)
    prefix = f"{alias}." if alias else ""
    assert predicate.count(f"{prefix}user_id") == 2
    if alias:
        assert " user_id IS NULL" not in f" {predicate}"


def test_no_statement_qualifies_the_bare_predicate_by_hand() -> None:
    """The helper being right is not enough; the call sites have to use it.

    Review found `_drop_unreferenced_global_groups` interpolating `g.{_UNOWNED}`
    — which qualifies the *first* of the two `user_id` references and leaves the
    second bare. It happens to resolve, because that `DELETE` has one table in
    scope, and it is exactly the ambiguity `_unowned` was added for after it
    aborted a real run against an empty database.

    The test above pins the helper and could never have reached that call site,
    so this reads the revision's source instead. A bare `{_UNOWNED}` is fine; a
    `<alias>.{_UNOWNED}` is the mistake, and there is no legitimate use of it.
    """
    import pathlib
    import re

    source = pathlib.Path(migration.__file__).read_text()
    offenders = re.findall(r"\w+\.\{_UNOWNED\}", source)

    assert not offenders, (
        f"{offenders} qualify only the first of the predicate's two column "
        "references. Call `_unowned(alias)`, which qualifies both."
    )


def test_every_account_delete_path_repoints_the_groups_first() -> None:
    """A third delete route must not be able to forget this.

    The repoint is a rule about the cascade, and the cascade is in the schema —
    so a new route that deletes a `User` inherits the hazard automatically and
    the fix not at all. `test_channel_creation_paths.py` guards the Follow
    writers the same way and for the same reason.

    Order is part of the claim, not decoration: after `session.delete(user)` the
    groups are already gone and the repoint finds nothing to move, so the call
    has to come *first* in the function body. That is what this walks — the
    index of each statement, not merely its presence.
    """
    import ast
    import pathlib

    module = pathlib.Path(__file__).resolve().parents[2] / "app/api/routes/users.py"
    tree = ast.parse(module.read_text())

    problems: list[str] = []
    found = 0

    for func in ast.walk(tree):
        if not isinstance(func, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        statements = list(ast.walk(func))

        delete_at = [
            index
            for index, node in enumerate(statements)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "delete"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "session"
            and node.args
            and _names_a_user(node.args[0])
        ]
        if not delete_at:
            continue
        found += 1

        repoint_at = [
            index
            for index, node in enumerate(statements)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "release_groups_of_deleted_account"
        ]
        if not repoint_at:
            problems.append(
                f"{func.name} deletes a User without calling "
                "release_groups_of_deleted_account — a Channel another account "
                "follows will be left naming a group that cascaded away"
            )
        elif min(repoint_at) > min(delete_at):
            problems.append(
                f"{func.name} repoints *after* deleting the User, which finds "
                "nothing left to move"
            )

    assert found >= 2, (
        f"expected both account-delete routes, found {found} — this guard is "
        "looking at the wrong thing"
    )
    assert not problems, "\n  ".join(problems)


def _names_a_user(node: ast.expr) -> bool:
    """Whether this argument to `session.delete(...)` is an account.

    Deliberately loose — `current_user`, `user`, and `session.get(User, id)` are
    the three spellings in the module, and a guard that only knew the exact two
    in use today would miss the third route it exists to catch.
    """
    if isinstance(node, ast.Name):
        return "user" in node.id.lower()
    if isinstance(node, ast.Call):
        return any(isinstance(arg, ast.Name) and arg.id == "User" for arg in node.args)
    return False
