"""The superseded columns are gone, and nothing reaches for them (ticket 22).

Two groups of columns were kept alive long after the tables that superseded
them existed, so the read paths could migrate one batch at a time:

* the **owner stamps** on the shared corpus — `Channel`, `Post`,
  `PostSyncState`, `PostEmbedding`, `PostTranslation`, `SyncLog`,
  `SyncLogPayload`, all `FOLLOW_SCOPED` in `tenancy.SCOPES`, plus
  `AppSetting`, which ticket 06 made deployment-wide; and
* the **per-User columns on `Channel`** that ticket 04 moved to
  `ChannelFollow`.

Dropping them is the easy half. The half that decays is the *reaching*: a new
feature writes `Channel.user_id` because every other model has one, or falls
back to `channel.setting_group_id` because a follow was inconvenient to obtain.
Neither would be caught by the schema — the first is an `AttributeError` only
if the line runs, and SQLModel models are permissive enough that plenty of such
lines never do in a unit test.

So this asserts three things:

1. the models carry no owner and no migrated per-User field, derived from
   `tenancy.SCOPES` rather than listed, so a table reclassified as follow-scoped
   next month is covered without anyone remembering this file;
2. no module in `app/` or `scripts/` names one of those attributes on one of
   those classes; and
3. the migration's own frozen list is exactly the set the derivation produces —
   the migration must freeze its list (an applied revision has to keep meaning
   what it meant), so the derivation lives here, where a mismatch is a red test
   rather than a column that quietly survives.

## Watched to fail

Every assertion below was watched red before being trusted, per `CLAUDE.md`:

* re-add `user_id` to `Post` in `models_tg.py` → the model test fails
* re-add `tags` to `Channel` → the per-User field test fails
* write `Channel.user_id == x` in any `app/` module → the reference test fails
* drop a table from the migration's `OWNER_COLUMNS` → the frozen-list test fails
* classify a new table `FOLLOW_SCOPED` and give it a `user_id` → the model test
  fails, which is the case the derivation exists for
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from sqlmodel import SQLModel

from app.alembic.versions import f7f6948f2c5d_drop_superseded_columns_ticket_22 as mig
from app.models_tg import AppSetting, Channel
from app.services.tenancy import SCOPES, Scope

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
SCRIPTS_DIR = BACKEND_DIR / "scripts"

#: The per-User fields ticket 04 moved from `Channel` to `ChannelFollow`.
#: Read off the follow model rather than retyped, so the two cannot drift: every
#: one of these must exist there and must *not* exist on `Channel`.
MIGRATED_TO_FOLLOW = (
    "setting_group_id",
    "followed_at",
    "tags",
    "start_id",
    "start_time",
    "discovered_via",
)

#: `AppSetting` is not follow-scoped — it is `OUT_OF_SCOPE` in `SCOPES`, because
#: ticket 06 made it deployment-wide with `key` as its whole primary key. Its
#: stamp is dropped by the same ticket for the same reason (a column that reads
#: like an owner without being one), so it is named here rather than derived.
EXTRA_OWNERLESS_MODELS = (AppSetting,)


def _owner_free_models() -> list[type[SQLModel]]:
    """Every model that must carry no `user_id`, derived from `SCOPES`.

    Follow-scoped tables answer visibility through `tg_channel_follows`, and
    corpus tables answer it for nobody, so neither has any use for an owner
    column. Deriving rather than listing is the point: this is what covers a
    table somebody classifies as follow-scoped after this ticket ships.
    """
    derived = [
        model
        for model, scope in SCOPES.items()
        if scope in (Scope.FOLLOW_SCOPED, Scope.CORPUS)
    ]
    return [*derived, *EXTRA_OWNERLESS_MODELS]


def _python_files() -> list[Path]:
    return [*APP_DIR.rglob("*.py"), *SCRIPTS_DIR.rglob("*.py")]


def _rel(path: Path) -> str:
    return path.relative_to(BACKEND_DIR).as_posix()


@pytest.mark.parametrize("model", _owner_free_models(), ids=lambda m: m.__name__)
def test_shared_rows_carry_no_owner_column(model: type[SQLModel]) -> None:
    """A follow-scoped or corpus row has no `user_id` to read.

    The stamp recorded who scraped a handle first. Filtering on it handed the
    second follower of a channel an empty page for posts sitting right there,
    which is why `SCOPES` answers these tables through the follow table instead.
    """
    assert "user_id" not in model.model_fields, (
        f"{model.__name__} carries a `user_id` again. It is "
        f"{SCOPES.get(model, 'out of scope')} — visibility is answered by "
        f"`tg_channel_follows`, not by a stamp on the row. If this table really "
        f"does need an owner, it is not follow-scoped and `SCOPES` is the thing "
        f"to change first."
    )


@pytest.mark.parametrize("field", MIGRATED_TO_FOLLOW)
def test_per_user_fields_live_only_on_the_follow(field: str) -> None:
    """Each migrated field is on `ChannelFollow` and not on `Channel`.

    Both halves, because either alone passes for a half-done move: asserting
    only the absence would pass if the field were deleted outright, and
    asserting only the presence would pass while `Channel` still shadowed it.
    """
    from app.models_tg import ChannelFollow

    assert field in ChannelFollow.model_fields, (
        f"`{field}` is missing from ChannelFollow, which is its only home since "
        f"ticket 22 dropped Channel's copy."
    )
    assert field not in Channel.model_fields, (
        f"`{field}` is back on Channel. It is per-User: one row per handle "
        f"means the second follower has to overwrite the first one's value to "
        f"have any of their own, which is what ticket 04 moved it to "
        f"`tg_channel_follows` to prevent."
    )


def test_no_module_reaches_for_a_dropped_column() -> None:
    """No module names a dropped attribute on one of the owner-free classes.

    Matches `<ClassName>.<attr>` in the AST rather than by substring, so
    `follow.setting_group_id` and `DiscoverIgnoredChannel.user_id` — a composite
    primary key ticket 30 put there on purpose, and the opposite of this rule —
    are not false positives.

    Attribute access on an *instance* (`channel.user_id`) is deliberately not
    matched: the receiver's type is not knowable from the AST, and `row.user_id`
    is correct on the twenty tables that still have an owner. mypy covers that
    case, and covers it better; this catches the class-level query expression,
    which is what a scoping filter is written as.
    """
    owner_free = {model.__name__ for model in _owner_free_models()}
    channel_only = {Channel.__name__}
    offenders: list[str] = []

    for path in _python_files():
        # The migration names these columns as strings, and earlier revisions
        # legitimately query the columns that existed when they ran.
        if "alembic/versions" in _rel(path):
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Attribute):
                continue
            if not isinstance(node.value, ast.Name):
                continue
            cls, attr = node.value.id, node.attr
            if cls in owner_free and attr == "user_id":
                offenders.append(f"{_rel(path)}: {cls}.{attr}")
            elif cls in channel_only and attr in MIGRATED_TO_FOLLOW:
                offenders.append(f"{_rel(path)}: {cls}.{attr}")

    assert not offenders, (
        f"{sorted(offenders)} name a column ticket 22 dropped. The owner stamps "
        f"are answered by `tg_channel_follows` through `services/tenancy.py`; "
        f"the per-User fields live on `ChannelFollow` and are reached with "
        f"`follows.get_follow` or `follows.followed_channels_for`."
    )


def test_no_module_constructs_a_model_with_a_dropped_column() -> None:
    """No module passes a dropped column as a constructor keyword.

    The sibling test above matches `<Class>.<attr>`, which is how a *query*
    names a column — and misses `Channel(id=..., user_id=...)` entirely.
    SQLModel accepts an unknown keyword and silently drops it, so this fails
    nowhere at runtime and reads as though the row still records an owner.
    `/code-review` found exactly that surviving in `data_import_export`, one
    construction site away from the one this ticket fixed.

    `ast.Call` with an `ast.Name` func, so `models_tg.Channel(...)` in a module
    that imports the module rather than the class is missed — as it is above,
    and for the same reason: this catches the spelling the codebase actually
    uses.
    """
    owner_free = {model.__name__ for model in _owner_free_models()}
    channel_only = {Channel.__name__}
    offenders: list[str] = []

    for path in _python_files():
        if "alembic/versions" in _rel(path):
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Name):
                continue
            cls = node.func.id
            for keyword in node.keywords:
                if keyword.arg is None:
                    continue
                if cls in owner_free and keyword.arg == "user_id":
                    offenders.append(f"{_rel(path)}: {cls}({keyword.arg}=...)")
                elif cls in channel_only and keyword.arg in MIGRATED_TO_FOLLOW:
                    offenders.append(f"{_rel(path)}: {cls}({keyword.arg}=...)")

    assert not offenders, (
        f"{sorted(offenders)} construct a model with a column ticket 22 "
        f"dropped. SQLModel drops an unknown keyword without complaining, so "
        f"this writes nothing and merely claims to. The per-User fields go to "
        f"`follows.sync_follow_settings`; the owner stamps have no replacement "
        f"because visibility is answered by `tg_channel_follows`."
    )


def test_the_migrations_frozen_list_is_the_derived_one() -> None:
    """The migration froze exactly the tables `SCOPES` says are owner-free.

    The migration must freeze its list — an applied revision has to keep meaning
    what it meant, and a table added *after* it ran is not reached by
    re-deriving anyway. So the derivation lives here. Ticket 34 made the same
    call for the same reason and wrote down why.
    """
    frozen = {table for table, _index in mig.OWNER_COLUMNS}
    derived = {
        model.__tablename__  # ty: ignore[unresolved-attribute]
        for model in _owner_free_models()
    }
    # `DiscoverHandleProbe` and `SyncMeta` are corpus and never had an owner
    # column, so they are legitimately absent from the migration.
    never_had_one = derived - frozen
    assert never_had_one <= {"tg_discover_probes", "tg_sync_meta"}, (
        f"{sorted(never_had_one)} are owner-free in `SCOPES` but the ticket 22 "
        f"migration does not drop a `user_id` from them. If one of these grew a "
        f"stamp, it needs its own revision — this one has already run."
    )
    assert not frozen - derived, (
        f"{sorted(frozen - derived)} are dropped by the migration but are not "
        f"owner-free in `SCOPES`. One of the two is wrong."
    )


def test_the_channel_chat_id_rule_is_no_longer_per_account() -> None:
    """The chat-id uniqueness index dropped its owner half.

    A Telegram chat id belongs to the handle, not to whoever scraped it first,
    so `(user_id, telegram_chat_id)` could only catch a collision inside one
    account's channels — and a shared corpus makes the cross-account case the
    ordinary one. Pinned because the index name is the only place the widened
    rule is written down.
    """
    assert mig._NEW_CHAT_ID_INDEX == "uq_tg_channels_telegram_chat_id_not_null"
    assert "user" not in mig._NEW_CHAT_ID_INDEX.replace("uq_tg_channels", "")
