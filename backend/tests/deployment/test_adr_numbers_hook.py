"""The pre-commit check that fails two ADRs claiming one number.

ADR-045 began as ADR-044 on a branch cut before Walked ranges merged its own
ADR-044; the clash surfaced only as a README conflict and a rename through
the spec, both tickets and the plan. These pin what counts as a clash.
"""

from __future__ import annotations

import importlib.util
import pathlib

_SCRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts/check_adr_numbers.py"
_spec = importlib.util.spec_from_file_location("check_adr_numbers", _SCRIPT)
assert _spec is not None and _spec.loader is not None
check_adr_numbers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_adr_numbers)

HERE = ["ADR-043-complete-window.md", "ADR-044-refresh-by-posts.md"]


def test_a_number_both_sides_added_clashes() -> None:
    assert check_adr_numbers.clashes(
        HERE,
        ["docs/adr/ADR-044-refresh-by-posts.md"],
        ["docs/adr/ADR-044-walked-ranges.md"],
    ) == [
        "ADR-044: ADR-044-refresh-by-posts.md here,"
        " ADR-044-walked-ranges.md on origin/main"
    ]


def test_two_files_in_the_tree_with_one_number_clash() -> None:
    """After main is merged in, both files sit in the tree."""
    assert check_adr_numbers.clashes([*HERE, "ADR-044-walked-ranges.md"], [], []) == [
        "ADR-044: ADR-044-refresh-by-posts.md, ADR-044-walked-ranges.md"
    ]


def test_distinct_numbers_and_renames_pass() -> None:
    assert (
        check_adr_numbers.clashes(
            HERE,
            ["docs/adr/ADR-045-refresh-by-posts.md"],
            ["docs/adr/ADR-044-walked-ranges.md", "docs/adr/README.md"],
        )
        == []
    )
