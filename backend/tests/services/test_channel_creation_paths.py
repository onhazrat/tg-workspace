"""Every path that creates a Channel also writes a Follow (ticket 04).

The dual-write is the whole of ticket 04's behaviour change, and it is the kind
of rule that decays silently: a new feature adds a fourth `Channel(...)`
somewhere, nobody remembers the follow, and the Channel is invisible to its own
creator the day ticket 21 flips enforcement on. Nothing in the type system or
the schema catches that — `Channel.user_id` is nullable and unconstrained, so
the row inserts happily and reads fine right up until the flip.

`CLAUDE.md` is explicit about why this is a test rather than a paragraph: the
"never inline `BaseModel` in a route module" rule sat in prose from B1 onward
and three modules were violating it by the time anyone checked.

So this walks the AST of `app/` and `scripts/`, finds every module that
constructs a `Channel`, and requires two things of each: that it is declared
below with a reason, and that it also names one of the follow-writing helpers.
The second half is what makes the guard about behaviour rather than
bookkeeping — a declared module that quietly stopped writing follows would
otherwise pass.

## Watched to fail

* add a bare `Channel(...)` to a module not in `CHANNEL_CREATORS` → the
  declaration test fails
* delete the `ensure_follow_for_channel` call from `channels.py` while leaving
  it declared → the dual-write test fails
* rename `ensure_follow` and update only the aggregate → the writer-set test
  fails, because the declared name no longer exists in `follows.py`
* point a creator at `session.add(ChannelFollow(...))` directly → the
  sole-writer test fails
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
SCRIPTS_DIR = BACKEND_DIR / "scripts"

#: Modules allowed to construct a `Channel`, and why each one exists. A fourth
#: entry here is a decision — two creation paths were already judged worse than
#: one shared helper (see `EXCEPTIONS` in `test_service_kinds.py`), so a new one
#: should have to argue for itself.
CHANNEL_CREATORS: dict[str, str] = {
    "app/services/channels.py": (
        "The upsert behind PUT /data/channels/{id} — the aggregate that owns the table."
    ),
    "app/services/followed_channels.py": (
        "The shared Discover / auto-follow creation path. Writes Channel "
        "alongside channels.py on purpose so the two flows cannot diverge."
    ),
    "app/services/data_import_export.py": (
        "Import restores channels from an exported document, inside the "
        "single transaction the whole document shares."
    ),
    "app/models_tg.py": "Declares the class; does not construct one.",
}

#: The functions that write `tg_channel_follows`. All of them live in the
#: aggregate — the point of naming them here is that a creator has to call one
#: of these, not that it has to call a particular one.
FOLLOW_WRITERS = ("ensure_follow_for_channel", "ensure_follow")

#: Modules permitted to name `ChannelFollow` in a constructor position. The
#: aggregate writes it; the other two only reference the class — `models_tg.py`
#: declares it and `tenancy.py` builds the EXISTS against it. Everything else,
#: the backfill included, goes through `ensure_follow`.
FOLLOW_TABLE_WRITERS = {
    "app/services/follows.py",
    "app/models_tg.py",
    "app/services/tenancy.py",
}


def _python_files() -> list[Path]:
    return [*APP_DIR.rglob("*.py"), *SCRIPTS_DIR.rglob("*.py")]


def _rel(path: Path) -> str:
    return path.relative_to(BACKEND_DIR).as_posix()


def _constructs_channel(tree: ast.AST) -> bool:
    """Whether the module calls `Channel(...)` anywhere.

    Matches the bare name only. `ChannelFollow(...)` and
    `ChannelSettingGroup(...)` are different classes and `ast.Name.id` compares
    whole identifiers, so there is no prefix confusion to guard against here —
    unlike the `localStorage` guard ticket 02 had to rewrite.
    """
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "Channel"
        for node in ast.walk(tree)
    )


def _names_used(tree: ast.AST) -> set[str]:
    return {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)} | {
        node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)
    }


def _creator_modules() -> dict[str, ast.AST]:
    found: dict[str, ast.AST] = {}
    for path in _python_files():
        if path.name.startswith("test_"):
            continue
        tree = ast.parse(path.read_text())
        if _constructs_channel(tree):
            found[_rel(path)] = tree
    return found


def test_every_channel_creating_module_is_declared() -> None:
    """A module nobody declared is a creation path nobody thought about."""
    found = set(_creator_modules())
    undeclared = sorted(found - set(CHANNEL_CREATORS))

    assert not undeclared, (
        f"These modules construct a Channel but are not declared in "
        f"CHANNEL_CREATORS: {undeclared}. Add an entry saying why the path "
        f"exists, and make sure it writes a ChannelFollow too — a Channel with "
        f"no follow is invisible to its own creator once ticket 21 flips "
        f"enforcement on."
    )


def test_every_declared_creator_still_creates_channels() -> None:
    """The other direction: a stale entry is a rule protecting nothing.

    `client-split.conform.ts` is the pattern — assert the reason, not just the
    state, so an exception that stopped applying shows up as a failure instead
    of quietly outliving what it excused.
    """
    found = set(_creator_modules())
    stale = sorted(set(CHANNEL_CREATORS) - found - {"app/models_tg.py"})

    assert not stale, (
        f"These modules are declared as Channel-creation paths but no longer "
        f"construct one: {stale}. Drop them from CHANNEL_CREATORS."
    )


@pytest.mark.parametrize(
    "module",
    sorted(set(CHANNEL_CREATORS) - {"app/models_tg.py"}),
)
def test_each_creator_also_writes_a_follow(module: str) -> None:
    """The half that is about behaviour rather than bookkeeping."""
    tree = ast.parse((BACKEND_DIR / module).read_text())
    used = _names_used(tree)

    assert used & set(FOLLOW_WRITERS), (
        f"{module} constructs a Channel but never calls one of "
        f"{FOLLOW_WRITERS}. Every Channel needs a ChannelFollow written in the "
        f"same transaction, or it belongs to nobody."
    )


def test_the_declared_follow_writers_exist() -> None:
    """A guard naming a function that was renamed is a guard that passes blind."""
    aggregate = ast.parse((APP_DIR / "services" / "follows.py").read_text())
    defined = {
        node.name
        for node in ast.walk(aggregate)
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
    }

    assert set(FOLLOW_WRITERS) <= defined, (
        f"FOLLOW_WRITERS names {sorted(set(FOLLOW_WRITERS) - defined)}, which "
        f"`app/services/follows.py` does not define. Rename here too, or the "
        f"dual-write check silently stops checking anything."
    )


def test_the_follow_table_has_one_writer() -> None:
    """Naming `ChannelFollow` outside the aggregate is the one-writer rule broken.

    `test_service_kinds.py` says an aggregate is the *only* module that writes
    its table. That is enforced there by declaration; this enforces it by
    construction for the table ticket 04 adds, because the dual-write puts the
    temptation to `session.add(ChannelFollow(...))` directly into three modules
    at once.
    """
    offenders = []
    for path in _python_files():
        if _rel(path) in FOLLOW_TABLE_WRITERS or path.name.startswith("test_"):
            continue
        tree = ast.parse(path.read_text())
        # Any mention of the name, not just constructor position. The aggregate
        # itself writes the table with `pg_insert(ChannelFollow)`, so the idiom
        # a second writer would most plausibly copy is not an `ast.Call` on the
        # class at all — nor are `delete(ChannelFollow)` and
        # `update(ChannelFollow)`. Matching the identifier costs a false
        # positive on a type annotation, which is a cheap thing to argue about
        # in review and an expensive thing to miss.
        names = any(
            isinstance(node, ast.Name) and node.id == "ChannelFollow"
            for node in ast.walk(tree)
        )
        if names:
            offenders.append(_rel(path))

    assert not offenders, (
        f"{sorted(offenders)} construct a ChannelFollow directly. "
        f"`app/services/follows.py` is the aggregate and the only writer; go "
        f"through `ensure_follow` so the conflict handling and the operator "
        f"fallback live in one place."
    )
