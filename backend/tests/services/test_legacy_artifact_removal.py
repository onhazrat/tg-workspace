"""The Artifacts that could not supply a Scope are gone, and so is every way of
inventing one for them (AW-07).

AW-05 and AW-06 put all four Artifact families on one frozen-Scope contract and
left two things behind on purpose: the rows written before the contract existed,
and the per-kind columns the frozen `scope` supersedes. This is the ticket that
removes both, and it is the one irreversible step in the effort — which is why
it got its own revision and gets its own guard.

## The rule

**Nothing in History claims a Scope it does not have.** An incomplete snapshot
is deleted rather than backfilled, because a guessed filter is a lie about which
Posts produced a result.

Discover is the interesting case and the reason the rule is stated that
strongly. It is the one family that *could* have been backfilled honestly — it
stored `keyword`, `forwarded`, `media`, the cap, the cap mode and the seed from
the start — and it is deleted on exactly the same terms as the three that could
not. A rule with one silent exception is not a rule, and the exception would
have been the thing nobody could state afterwards.

## What this asserts

1. the upgrade deletes a scope-less row of every kind **and its payload row**,
   run against the schema as it stood before the revision;
2. it leaves a row that has a Scope alone, byte for byte — no backfill, no
   default, no filter inferred from a neighbouring column;
3. the thirteen superseded columns are gone from the models and from the
   database, derived from the migration's own frozen lists;
4. no module in `app/` or `scripts/` names one of them, as a query expression or
   as a constructor keyword — SQLModel accepts an unknown keyword and drops it,
   so that half fails nowhere at runtime;
5. `discover_reports._scope` no longer reconstructs a Scope from the columns
   beside it, which is the one place that could;
6. `tg_discover_reports.scope` is NOT NULL, and the import door answers 422
   rather than letting a pre-contract document walk those rows back in;
7. the upgrade runs on an empty database, and the downgrade puts the columns
   back without claiming to restore the rows.

## Watched to fail

Every assertion below was watched red before being trusted, per `CLAUDE.md`:

* drop the payload `DELETE`s from `upgrade()` -> the orphaned-payload case
* make `upgrade()` backfill `channels` from the Scope -> the untouched case
* re-add `start_date` to `Summary` -> the model and database cases
* write `Summary.channels` in an `app/` module -> the reference case
* re-add the reconstruction branch to `_scope` -> the no-reconstruction case
* make `tg_discover_reports.scope` nullable again -> the NOT NULL case
* drop `require=("scope",)` from the report import -> the import-door case
"""

from __future__ import annotations

import ast
import inspect
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from sqlmodel import Session, SQLModel

from app.alembic.versions import (
    c9e4a8b71d25_aw07_drop_incomplete_legacy_artifacts as mig,
)
from app.core.db import engine
from app.models_tg import (
    ChatSession,
    DiscoverReport,
    Summary,
    TagRun,
)
from app.services import discover_reports
from app.services.data_import_export import import_data
from tests.utils.scope import stored_scope
from tests.utils.tenancy import ANY_READER

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
SCRIPTS_DIR = BACKEND_DIR / "scripts"

#: Model class per table, so the schema claims and the model claims are the same
#: list read twice rather than two lists that can drift.
MODELS: dict[str, type[SQLModel]] = {
    "tg_summaries": Summary,
    "tg_chat_sessions": ChatSession,
    "tg_tag_runs": TagRun,
    "tg_discover_reports": DiscoverReport,
}

#: What each table lost, derived from the migration's frozen tuples. The
#: migration has to freeze its own list — an applied revision keeps meaning what
#: it meant — so this reads that list rather than retyping it, and a column
#: quietly left out of the revision shows up here as a red test.
DROPPED: dict[str, tuple[str, ...]] = {
    table: ("channels", "start_date", "end_date")
    + (mig._REPORT_FILTER_COLUMNS if table == "tg_discover_reports" else ())
    for table in mig._TRIO_TABLES
}

#: The DDL that puts the pre-AW-07 schema back, as the previous revision left
#: it. `downgrade()` is the authority on it, so the fixture below calls that
#: rather than spelling the columns out a second time.
_PAYLOADS = {
    "tg_summary_payloads": ("summary_id", Summary),
    "tg_chat_session_payloads": ("chat_session_id", ChatSession),
}


def _operations(connection: sa.Connection) -> Operations:
    return Operations(MigrationContext.configure(connection))


def _run(fn: Any) -> None:
    """Run one half of the revision against the live database.

    Through alembic's own `Operations` proxy rather than by re-issuing the SQL,
    so what is tested is the revision file and not a paraphrase of it.
    """
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            fn()


@pytest.fixture
def pre_aw07_schema(db: Session | None) -> Iterator[None]:
    """Put the thirteen columns back for one test, then take them away again.

    Takes `db` first, and for the reason `legacy_owner_schema` documents: the
    session-scoped fixture holds one transaction open for the whole run, and
    `ALTER TABLE` needs `ACCESS EXCLUSIVE`, so without committing it first the
    DDL waits for something that cannot happen until the run ends. **Request
    this fixture before `session` or `client`.**

    Restored explicitly rather than rolled back, because the body commits.
    """
    if db is not None:
        db.commit()
    _clear_artifacts()
    _run(mig.downgrade)
    try:
        yield
    finally:
        _clear_artifacts()
        # Idempotent, because some of these tests run the upgrade themselves —
        # that is what they are for — and `drop_column` on an absent column is
        # an error rather than a no-op.
        if "channels" in _columns("tg_summaries"):
            _run(mig.upgrade)


def _clear_artifacts() -> None:
    """Empty the four tables and their payload tables.

    The upgrade is destructive by design, so a test that runs it must not be
    able to delete another module's fixtures — and the downgrade leaves every
    surviving row with a NULL channel list, which is not a state the rest of the
    suite should ever see.
    """
    with engine.begin() as connection:
        for table in (*_PAYLOADS, *mig._TRIO_TABLES):
            connection.execute(sa.text(f"DELETE FROM {table}"))  # noqa: S608


def _seed_legacy(connection: sa.Connection, *, with_scope: bool) -> str:
    """One row of every kind, with a payload row where the family has one.

    `with_scope=False` is the pre-contract row this ticket deletes;
    `with_scope=True` is the one it must leave alone. Written as raw SQL because
    the models no longer have the columns — which is the point of running this
    against the restored schema rather than through the ORM.
    """
    tag = uuid.uuid4().hex[:8]
    scope = stored_scope(channels=["kept"], start=1_000, end=61_000)
    scope_sql = "CAST(:scope AS json)" if with_scope else "NULL"
    params: dict[str, Any] = {"owner": ANY_READER, "tag": tag}
    if with_scope:
        params["scope"] = _json(scope)

    connection.execute(
        sa.text(  # noqa: S608
            "INSERT INTO tg_summaries "
            "(id, user_id, text, channels, start_date, end_date, language, "
            " timestamp, extra, scope, chat_message_count, updated_at) VALUES "
            f"(:tag, :owner, 'body', '[\"legacy\"]', 7, 8, 'English', 1, "
            f" '{{}}', {scope_sql}, 0, now())"
        ),
        params,
    )
    connection.execute(
        sa.text(
            "INSERT INTO tg_summary_payloads (summary_id, user_id, updated_at) "
            "VALUES (:tag, :owner, now())"
        ),
        params,
    )
    connection.execute(
        sa.text(  # noqa: S608
            "INSERT INTO tg_chat_sessions "
            "(id, user_id, title, channels, start_date, end_date, language, "
            " mode, timestamp, extra, scope, message_count, updated_at) VALUES "
            f"(:tag, :owner, 't', '[\"legacy\"]', 7, 8, 'English', 'full_scope', "
            f" 1, '{{}}', {scope_sql}, 0, now())"
        ),
        params,
    )
    connection.execute(
        sa.text(
            "INSERT INTO tg_chat_session_payloads "
            "(chat_session_id, user_id, updated_at) "
            "VALUES (:tag, :owner, now())"
        ),
        params,
    )
    connection.execute(
        sa.text(  # noqa: S608
            "INSERT INTO tg_tag_runs "
            "(id, user_id, status, source, mode, channels, start_date, end_date, "
            " all_tags_snapshot, channel_context_options, suggestions, "
            " apply_result, extra, scope, created_at, updated_at_ms, "
            " updated_at) VALUES "
            f"(:tag, :owner, 'pending', 'generated', 'add', '[\"legacy\"]', 7, 8, "
            f" '[]', '{{}}', '{{}}', '{{}}', '{{}}', {scope_sql}, 1, 1, now())"
        ),
        params,
    )
    connection.execute(
        sa.text(  # noqa: S608
            "INSERT INTO tg_discover_reports "
            "(id, user_id, channels, start_date, end_date, signals, forwarded, "
            " media, max_per_channel, max_per_channel_mode, seed, keyword, "
            " candidates, scope_counts, posts_in_scope, candidate_count, "
            " timestamp, extra, scope, updated_at) VALUES "
            f"(:tag, :owner, '[\"legacy\"]', 7, 8, '[]', 'all', 'all', 0, "
            f" 'latest', 0, 'legacy', '[]', '{{}}', 0, 0, 1, '{{}}', "
            f" {scope_sql}, now())"
        ),
        params,
    )
    return tag


def _json(value: dict[str, Any]) -> str:
    import json

    return json.dumps(value)


def _columns(table: str) -> set[str]:
    with engine.connect() as connection:
        return {
            row[0]
            for row in connection.execute(
                sa.text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = :t"
                ),
                {"t": table},
            )
        }


# -----------------------------------------------------------------------------
# 1 & 2. The upgrade, run against the schema as it stood before it.
# -----------------------------------------------------------------------------


def test_the_upgrade_deletes_every_kind_that_cannot_supply_a_scope(
    pre_aw07_schema: None,
) -> None:
    """All four families, and the payload rows nothing cascades from.

    `tg_summary_payloads` and `tg_chat_session_payloads` carry no foreign key to
    their parent — deliberately, so both stay droppable and truncatable — so a
    revision that deleted only the parents would leave rows no query can reach
    and no retention sweep collects.
    """
    with engine.begin() as connection:
        doomed = _seed_legacy(connection, with_scope=False)
        kept = _seed_legacy(connection, with_scope=True)

    _run(mig.upgrade)

    with engine.connect() as connection:
        for table in mig._TRIO_TABLES:
            surviving = {
                row[0]
                for row in connection.execute(
                    sa.text(f"SELECT id FROM {table}")  # noqa: S608
                )
            }
            assert doomed not in surviving, (
                f"{table} kept a row with no frozen Scope. AW-07 deletes what "
                f"cannot supply the contract rather than displaying it as "
                f"though its missing filters were known."
            )
            assert kept in surviving, f"{table} deleted a row that had a Scope."

        for table, (key, _model) in _PAYLOADS.items():
            ids = {
                row[0]
                for row in connection.execute(
                    sa.text(f"SELECT {key} FROM {table}")  # noqa: S608
                )
            }
            assert doomed not in ids, (
                f"{table} kept the payload of a deleted Artifact. Nothing "
                f"cascades here, so the revision has to delete it by id."
            )
            assert kept in ids


def test_the_surviving_scope_is_not_touched(pre_aw07_schema: None) -> None:
    """No backfill, no default, no filter inferred from a neighbouring column.

    Seeded with a Scope whose channel list (`["kept"]`) disagrees with the
    superseded column beside it (`["legacy"]`), so a revision that "reconciled"
    the two in either direction fails here rather than shipping a Scope nobody
    recorded.
    """
    expected = stored_scope(channels=["kept"], start=1_000, end=61_000)
    with engine.begin() as connection:
        kept = _seed_legacy(connection, with_scope=True)

    _run(mig.upgrade)

    with engine.connect() as connection:
        for table in mig._TRIO_TABLES:
            stored = connection.execute(
                sa.text(f"SELECT scope FROM {table} WHERE id = :id"),  # noqa: S608
                {"id": kept},
            ).scalar_one()
            assert stored == expected, (
                f"{table} rewrote a frozen Scope. The revision drops columns "
                f"and deletes rows; it never edits a Scope."
            )


def test_the_upgrade_runs_on_an_empty_database(pre_aw07_schema: None) -> None:
    """A fresh install has no Artifacts, and the revision still has work to do.

    The destructive half is a no-op and the schema half is not, so this is the
    case where "delete the rows" and "drop the columns" being one revision could
    have gone wrong quietly.
    """
    _run(mig.upgrade)

    for table, dropped in DROPPED.items():
        assert not _columns(table) & set(dropped)


def test_the_downgrade_restores_the_columns_and_claims_no_rows(
    pre_aw07_schema: None,
) -> None:
    """A rollback of the code, never a recovery of the data.

    The columns come back so the previous revision's code can run; the rows do
    not, because nothing recorded them. The docstring says so, and this asserts
    it rather than trusting the docstring — a downgrade that silently restored
    nothing while reading as though it did is the failure worth catching.
    """
    with engine.begin() as connection:
        doomed = _seed_legacy(connection, with_scope=False)

    _run(mig.upgrade)
    _run(mig.downgrade)

    for table, dropped in DROPPED.items():
        assert set(dropped) <= _columns(table), (
            f"{table} did not get {sorted(dropped)} back, so the previous "
            f"revision's code cannot run against this database."
        )

    with engine.connect() as connection:
        for table in mig._TRIO_TABLES:
            ids = {
                row[0]
                for row in connection.execute(
                    sa.text(f"SELECT id FROM {table}")  # noqa: S608
                )
            }
            assert doomed not in ids

    assert "do not come back" in (mig.downgrade.__doc__ or ""), (
        "The downgrade's docstring is where an operator finds out the deleted "
        "Artifacts are gone for good. It is part of the contract, not a comment."
    )


# -----------------------------------------------------------------------------
# 3 & 4. The columns, and everything that could still reach for them.
# -----------------------------------------------------------------------------


@pytest.mark.parametrize("table", sorted(DROPPED))
def test_the_superseded_columns_are_gone_from_the_model(table: str) -> None:
    model = MODELS[table]
    still_there = sorted(set(DROPPED[table]) & set(model.model_fields))
    assert not still_there, (
        f"{model.__name__} carries {still_there} again. The frozen `scope` is "
        f"the one copy of which Posts produced an Artifact; a second column "
        f"holding the same thing is two answers that can disagree, which is "
        f"what AW-07 removed."
    )


@pytest.mark.parametrize("table", sorted(DROPPED))
def test_the_superseded_columns_are_gone_from_the_database(table: str) -> None:
    still_there = sorted(set(DROPPED[table]) & _columns(table))
    assert not still_there, f"{table} still has {still_there}."


def test_the_report_scope_column_refuses_a_row_without_one() -> None:
    """`tg_discover_reports.scope` is NOT NULL, unlike the other three.

    Its response model declares the Scope required rather than nullable —
    the scope card renders it unconditionally — so a report without one is a
    500, not a row that reads as "no Scope recorded". The other three answer
    `scope: null` honestly, which is why their legacy create doors can stay
    open and this one cannot.
    """
    with Session(engine) as session:
        session.add(
            DiscoverReport(
                id=f"aw07-{uuid.uuid4().hex[:8]}",
                user_id=ANY_READER,
                timestamp=0,
            )
        )
        with pytest.raises(sa.exc.IntegrityError):
            session.commit()
        session.rollback()


def _python_files() -> list[Path]:
    return [*APP_DIR.rglob("*.py"), *SCRIPTS_DIR.rglob("*.py")]


def _rel(path: Path) -> str:
    return path.relative_to(BACKEND_DIR).as_posix()


def _offenders(match: Any) -> list[str]:
    found: list[str] = []
    by_class = {MODELS[table].__name__: set(cols) for table, cols in DROPPED.items()}
    for path in _python_files():
        # Earlier revisions legitimately query the columns that existed when
        # they ran, and this one names them as strings in order to drop them.
        if "alembic/versions" in _rel(path):
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            found.extend(f"{_rel(path)}: {hit}" for hit in match(node, by_class))
    return sorted(found)


def test_no_module_reaches_for_a_dropped_column() -> None:
    """No module names `<Artifact>.<dropped column>` as a query expression.

    Matched on the class rather than by substring, because `keyword`, `media`,
    `forwarded` and `seed` are ordinary names elsewhere — `PostFilters.keyword`
    and `Post.media` are both live and both correct.

    Instance access (`report.keyword`) is deliberately not matched, for the
    reason `test_superseded_columns.py` gives: the receiver's type is not
    knowable from the AST. mypy covers that case and covers it better.
    """

    def match(node: ast.AST, by_class: dict[str, set[str]]) -> list[str]:
        if not isinstance(node, ast.Attribute):
            return []
        if not isinstance(node.value, ast.Name):
            return []
        if node.attr in by_class.get(node.value.id, set()):
            return [f"{node.value.id}.{node.attr}"]
        return []

    offenders = _offenders(match)
    assert not offenders, (
        f"{offenders} name a column AW-07 dropped. The window and the filters "
        f"are in the frozen `scope`; read it with `FrozenScope.from_stored`, "
        f"or reach one key of it in SQL the way "
        f"`services/artifacts.py::_scope_text` does."
    )


def test_no_module_constructs_an_artifact_with_a_dropped_column() -> None:
    """Nor passes one as a constructor keyword.

    The sibling above matches how a *query* names a column and misses
    `Summary(id=..., channels=[...])` entirely. SQLModel accepts an unknown
    keyword and drops it, so that line fails nowhere and reads as though the row
    still records a channel list.
    """

    def match(node: ast.AST, by_class: dict[str, set[str]]) -> list[str]:
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
            return []
        dropped = by_class.get(node.func.id, set())
        return [
            f"{node.func.id}({kw.arg}=...)" for kw in node.keywords if kw.arg in dropped
        ]

    offenders = _offenders(match)
    assert not offenders, (
        f"{offenders} construct an Artifact with a column AW-07 dropped. "
        f"SQLModel drops an unknown keyword without complaining, so this writes "
        f"nothing and merely claims to. The Scope goes in `scope`, through "
        f"`FrozenScope.stored()`."
    )


# -----------------------------------------------------------------------------
# 5 & 6. The two places that could still invent a Scope.
# -----------------------------------------------------------------------------


def test_nothing_reconstructs_a_scope_for_a_row_that_has_none() -> None:
    """`discover_reports._scope` lost its legacy branch with the columns it read.

    Discover was the one family that could rebuild a Scope honestly, and that
    branch is exactly why this ticket had to remove it rather than leave it as a
    harmless fallback: a reconstruction that still exists is a reconstruction
    somebody will point at a family that cannot do it honestly.
    """
    source = inspect.getsource(discover_reports._scope)
    named = sorted(
        column
        for column in DROPPED["tg_discover_reports"]
        if f'row["{column}"]' in source or f'row.get("{column}")' in source
    )
    assert not named, (
        f"`_scope` still reads {named} off the row. Those columns are gone; "
        f"what is left of that branch can only invent a Scope."
    )

    with pytest.raises(HTTPException) as raised:
        discover_reports._scope({"scope": None, "signals": []})
    assert raised.value.status_code == 500


def test_the_import_door_refuses_a_report_that_predates_the_contract() -> None:
    """A document is the one way a pre-AW-07 report could come back.

    The migration deletes them and the column refuses them; without this the
    refusal would be an `IntegrityError` — a 500 naming a constraint — rather
    than a 422 saying which section of the document could not be restored.
    """
    document = {
        "discover_reports": [
            {"id": f"aw07-{uuid.uuid4().hex[:8]}", "timestamp": 0, "candidates": []}
        ]
    }
    with Session(engine) as session, pytest.raises(HTTPException) as raised:
        import_data(session, document, user_id=ANY_READER)
    assert raised.value.status_code == 422
    assert "scope" in str(raised.value.detail)
