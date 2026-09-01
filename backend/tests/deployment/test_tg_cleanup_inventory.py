"""Every `tg_*` table is truncated between tests, or excused with a reason.

`scripts/tg_test_pollution.py::TG_TABLES` is what `conftest.py` truncates after
every test, and it is hand-written. That list has been wrong twice, and the file
records both: `tg_tag_runs` was missing until `/data/artifacts` started reading
it, and `tg_user_settings` had to be added beside `tg_app_settings` or the
ticket 06 carve half-survived a test. Ticket 24 made it three — `tg_quota_limits`
shipped absent, so a test that capped an account's Budget and left the User
behind handed the next test a silently capped account.

All three are the same defect, and it is the one this repo names everywhere
else: **an inventory that is listed rather than derived drifts the first time
somebody adds a table in a hurry.** The list itself cannot be derived — the
truncation order matters and a `RESTART IDENTITY CASCADE` over the wrong set is
worse than a leak — but the *coverage* can be, and that is what this asserts.

The failure it prevents is not a red test. It is a **green** one somewhere else,
in a module that has nothing to do with the table that leaked, on a run whose
ordering happened to put the two together — which is the most expensive kind of
failure this suite can produce.
"""

from __future__ import annotations

from sqlmodel import SQLModel

from app.models_tg import QuotaLimit  # noqa: F401  (import for registration)
from scripts.tg_test_pollution import TG_TABLES

#: Tables a test run must *not* clear, each with the reason. Empty today, and
#: that is the honest state: every `tg_*` table holds test-created rows and none
#: of them is seeded infrastructure a truncate would destroy.
#:
#: Kept rather than removed, because the day one is added the choice has to be
#: written down beside the list — the alternative is a table quietly dropped
#: from `TG_TABLES` with a commit message as its only explanation.
EXCUSED_FROM_TRUNCATION: dict[str, str] = {}


def _model_tg_tables() -> set[str]:
    """Every `tg_*` table SQLModel knows about, from the metadata.

    From `SQLModel.metadata` rather than by walking `__subclasses__()`: the
    metadata is what Alembic and `create_all` read, so a table present there and
    absent here is a table that really exists in a test database. Walking
    subclasses would also need the recursive descent `test_tenancy_seam.py`
    documents, for no gain.
    """
    return {name for name in SQLModel.metadata.tables if name.startswith("tg_")}


def test_every_tg_table_is_truncated_or_excused() -> None:
    """Mutation: drop any entry from `TG_TABLES`.

    This is the assertion that would have caught `tg_quota_limits`, and it
    catches the next one without anybody remembering to look.
    """
    listed = set(TG_TABLES) | set(EXCUSED_FROM_TRUNCATION)
    missing = sorted(_model_tg_tables() - listed)
    assert not missing, (
        "these tg_* tables are never cleared between tests:\n  "
        + "\n  ".join(missing)
        + "\n\nAdd them to TG_TABLES in scripts/tg_test_pollution.py, or to "
        "EXCUSED_FROM_TRUNCATION above with the reason a truncate must not "
        "reach them. Rows left behind by one test are another test's "
        "pre-existing state, and the test that fails is never this one."
    )


def test_no_entry_names_a_table_that_no_longer_exists() -> None:
    """The other direction. Mutation: rename a model's `__tablename__`.

    A `TRUNCATE` naming a dropped table raises, so this would surface as every
    test erroring in teardown — loud, but with a message about SQL rather than
    about the rename that caused it.
    """
    real = _model_tg_tables()
    stale = sorted(name for name in TG_TABLES if name not in real)
    assert not stale, "TG_TABLES names tables that no longer exist:\n  " + "\n  ".join(
        stale
    )


def test_the_inventory_has_no_duplicates() -> None:
    """A tuple, so a duplicate is silent. Mutation: paste an entry twice.

    Harmless to the `TRUNCATE` itself, and exactly the shape a careless merge
    leaves behind — worth one line to keep the list readable as an inventory.
    """
    assert len(TG_TABLES) == len(set(TG_TABLES)), (
        f"duplicate entries: "
        f"{sorted({t for t in TG_TABLES if list(TG_TABLES).count(t) > 1})}"
    )
