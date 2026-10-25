"""The pre-commit check that fails a `path.py::name` reference pointing at nothing.

A refactor that moves a function breaks the citations in other files, which
the commit never touches, so the hook reads the whole tree. These pin how a
reference resolves: by path suffix, against top-level names and class members.
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


def test_the_tree_has_no_dangling_reference() -> None:
    """The hook's own run, so a commit made with `--no-verify` still fails CI."""
    assert check_code_refs.main() == 0
