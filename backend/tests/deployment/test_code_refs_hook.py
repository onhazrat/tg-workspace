"""The pre-commit check that fails a code reference pointing at nothing.

A refactor that moves a function or deletes a file breaks the citations in
other files, which the commit never touches, so the hook reads the whole tree.
These pin how a reference resolves: a `path.py::name` by path suffix, against
top-level names and class members; a backticked file path against the files
the commit deletes or renames away.
"""

from __future__ import annotations

import importlib.util
import pathlib

_SCRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts/check_code_refs.py"
_spec = importlib.util.spec_from_file_location("check_code_refs", _SCRIPT)
assert _spec is not None and _spec.loader is not None
check_code_refs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_code_refs)

MODULE = """
LIMIT = 5
type Alias = int
count: int = 0


def feed() -> None: ...


class View:
    scope: int = 0

    def cap(self) -> None: ...
"""

PYTHON = {"backend/app/services/posts_view.py": check_code_refs.defined(MODULE)}


def _offenders(text: str) -> list[str]:
    return check_code_refs.offenders({"docs/x.md": text}, PYTHON)


def test_a_reference_resolves_by_path_suffix_and_name() -> None:
    assert (
        _offenders(
            "`services/posts_view.py::feed` `posts_view.py::LIMIT` "
            "`posts_view.py::Alias` `posts_view.py::count` "
            "`posts_view.py::View.cap` `posts_view.py::View.scope`"
        )
        == []
    )


def test_a_moved_name_or_module_is_flagged() -> None:
    assert _offenders(
        "one `posts_view.py::list_feed`\ntwo `posts.py::feed` `posts_view.py::View.gone`"
    ) == [
        "docs/x.md:1: posts_view.py::list_feed",
        "docs/x.md:2: posts.py::feed",
        "docs/x.md:2: posts_view.py::View.gone",
    ]


def test_an_unbackticked_mention_is_left_alone() -> None:
    assert _offenders("prose naming posts.py::list_feed without backticks") == []


TRACKED = ["frontend/src/components/Spread.tsx", "frontend/src/index.ts"]
GONE = [
    "frontend/src/components/channel-grid/ChannelMetricEditor.test.tsx",
    "frontend/src/lib/index.ts",
]


def _file_offenders(text: str) -> list[str]:
    return check_code_refs.file_offenders({"docs/x.md": text}, TRACKED, GONE)


def test_a_path_to_a_file_the_commit_deletes_is_flagged() -> None:
    assert _file_offenders(
        "pins it in `ChannelMetricEditor.test.tsx`\n"
        "and `channel-grid/ChannelMetricEditor.test.tsx` again"
    ) == [
        "docs/x.md:1: ChannelMetricEditor.test.tsx",
        "docs/x.md:2: channel-grid/ChannelMetricEditor.test.tsx",
    ]


def test_a_path_still_naming_a_tracked_file_is_left_alone() -> None:
    """`index.ts` still names `frontend/src/index.ts`, though one was deleted."""
    assert _file_offenders("`Spread.tsx` and `index.ts`") == []


def test_a_file_deleted_before_this_commit_is_history() -> None:
    """A record of what was removed long ago names a file no commit deletes now."""
    assert _file_offenders("`lib/cache.ts` was removed (ADR-012)") == []


def test_an_unbackticked_file_path_is_left_alone() -> None:
    assert _file_offenders("prose naming ChannelMetricEditor.test.tsx") == []


def test_the_tree_has_no_dangling_reference() -> None:
    """The hook's own run, so a commit made with `--no-verify` still fails CI."""
    assert check_code_refs.main() == 0


def test_the_locked_migration_records_are_history() -> None:
    # PVM-01 had to rewrite `DECISIONS.md`, which `CLAUDE.md` calls locked, to
    # drop a pointer to a file it deleted.
    assert check_code_refs.SKIPPED.match("docs/migration/DECISIONS.md")
    assert not check_code_refs.SKIPPED.match("docs/agents/architecture-guards.md")
