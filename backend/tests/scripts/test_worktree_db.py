"""A worktree's pytest database is named from the worktree and only it is dropped.

`scripts/worktree-setup.sh --teardown` drops whatever name this module
derives, so the refusal is the part that matters: a teardown run from the main
checkout, or with a hand-typed name, must never reach `app` or `app_test`.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from scripts import worktree_db


@pytest.mark.parametrize(
    ("directory", "expected"),
    [
        ("set-04-configuration-rows", "app_test_set_04_configuration_rows"),
        ("Agent-A1742FD5", "app_test_agent_a1742fd5"),
        ("--claude.md split--", "app_test_claude_md_split"),
    ],
)
def test_the_name_is_the_worktree_directory_made_an_identifier(
    tmp_path: Path, directory: str, expected: str
) -> None:
    assert worktree_db.database_name(tmp_path / directory) == expected


def test_a_long_worktree_name_is_cut_to_what_postgres_keeps(tmp_path: Path) -> None:
    name = worktree_db.database_name(tmp_path / ("x" * 100))
    assert len(name) == worktree_db.MAX_IDENTIFIER
    assert name.startswith(worktree_db.PREFIX)


def test_a_name_with_nothing_to_keep_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="cannot derive"):
        worktree_db.database_name(tmp_path / "---")


@pytest.mark.parametrize(
    "name", ["app", "app_test", "app_test_", "postgres", "x_app_test_y"]
)
def test_drop_refuses_anything_that_is_not_a_worktree_database(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The refusal comes before any connection, so a broken guard fails here
    # instead of reaching the server with the dev database's name.
    monkeypatch.setattr(
        worktree_db, "_admin_connection", lambda: pytest.fail("reached the server")
    )
    with pytest.raises(ValueError, match="refusing to drop"):
        worktree_db.drop(name)


def test_create_and_drop_are_idempotent_against_the_real_server() -> None:
    name = f"{worktree_db.PREFIX}pytest_{uuid.uuid4().hex[:8]}"
    try:
        assert worktree_db.create(name) is True
        assert worktree_db.create(name) is False
        assert worktree_db.exists(name)
        assert worktree_db.drop(name) is True
        assert worktree_db.drop(name) is False
        assert not worktree_db.exists(name)
    finally:
        if worktree_db.exists(name):
            worktree_db.drop(name)


def test_each_worktree_gets_its_own_ports_and_keeps_them(tmp_path: Path) -> None:
    """Two worktrees sharing Playwright's dev port test each other's code: one
    reused the other's server on 5180 and passed against the wrong checkout."""
    one = worktree_db.ports(tmp_path / "history-tab-redesign-spec-acb754")
    other = worktree_db.ports(tmp_path / "channel-directory-priority-filtering")

    assert one == worktree_db.ports(tmp_path / "history-tab-redesign-spec-acb754")
    assert one != other
    for dev, api in (one, other):
        assert worktree_db.DEV_PORTS.start <= dev < worktree_db.DEV_PORTS.stop
        assert api - dev == worktree_db.API_PORT_OFFSET
