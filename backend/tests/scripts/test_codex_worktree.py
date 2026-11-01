"""Codex setup owns its resources and leaves Claude's setup contract intact."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from scripts import codex_worktree as codex
from scripts import worktree_db


@pytest.fixture
def trees(tmp_path: Path) -> tuple[Path, Path]:
    root, main = tmp_path / "codex" / "repo", tmp_path / "main"
    (root / "backend").mkdir(parents=True)
    (root / "frontend").mkdir()
    main.mkdir()
    (main / ".env").write_text("ENVIRONMENT=local\n")
    return root, main


def configured(root: Path, dev: int = 20100) -> dict[str, str]:
    db, e2e = codex.database_names(root)
    (root / ".env.worktree").write_text(
        f"TEST_POSTGRES_DB={db}\nCODEX_E2E_POSTGRES_DB={e2e}\n"
        f"PLAYWRIGHT_DEV_PORT={dev}\nWORKTREE_API_PORT={dev + 10000}\n"
        f"PLAYWRIGHT_API_URL=http://127.0.0.1:{dev + 10000}\n"
    )
    return codex.read_config(root)


def test_identical_repo_names_in_different_worktrees_are_isolated(
    tmp_path: Path,
) -> None:
    roots = [tmp_path / identity / ("repo" * 40) for identity in ("aaaa", "bbbb")]
    names = [name for root in roots for name in codex.database_names(root)]
    assert len(set(names)) == 4
    assert all(len(name) <= 63 and name.startswith("app_test_") for name in names)
    assert codex.database_names(roots[0]) == codex.database_names(roots[0])
    assert (
        worktree_db.database_name(tmp_path / "Agent-A1742FD5")
        == "app_test_agent_a1742fd5"
    )
    assert worktree_db.ports(tmp_path / "tg_summarizer_migrate_to_fastapi") == (
        5365,
        8365,
    )


def test_port_allocation_skips_reservations_and_live_servers(
    trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    root, main = trees
    monkeypatch.setattr(
        codex, "git", lambda *_: f"worktree {main}\0\0worktree {root}\0"
    )
    monkeypatch.setattr(codex, "port_available", lambda _: True)
    first, api = codex.allocate_ports(root)
    (main / ".env.worktree").write_text(
        f"PLAYWRIGHT_DEV_PORT={first}\nWORKTREE_API_PORT={api}\n"
    )
    second, _ = codex.allocate_ports(root)
    monkeypatch.setattr(codex, "port_available", lambda port: port != second)
    third, third_api = codex.allocate_ports(root)
    assert len({first, second, third}) == 3
    assert third_api == third + codex.API_PORT_OFFSET


def test_foreign_configuration_is_refused_without_modifying_it(
    trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    root, main = trees
    path = root / ".env.worktree"
    original = "TEST_POSTGRES_DB=app_test_claude\n"
    path.write_text(original)
    monkeypatch.setattr(
        codex.subprocess, "run", lambda *_a, **_kw: pytest.fail("ran setup")
    )
    with pytest.raises(RuntimeError, match="another setup"):
        codex.setup(root, main)
    assert path.read_text() == original
    assert not (root / ".env").exists()


def test_setup_reruns_migrations_and_keeps_ports(
    trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    root, main = trees
    created: list[str] = []
    commands: list[tuple[list[str], dict[str, Any]]] = []

    def run(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        commands.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(worktree_db, "create", created.append)
    monkeypatch.setattr(codex.subprocess, "run", run)
    monkeypatch.setattr(codex, "allocate_ports", lambda _: (20100, 30100))
    codex.setup(root, main)
    first = (root / ".env.worktree").read_bytes()
    monkeypatch.setattr(
        codex, "allocate_ports", lambda _: pytest.fail("reallocated ports")
    )
    codex.setup(root, main)
    db, e2e = codex.database_names(root)
    assert created == [db, e2e, db, e2e]
    assert (root / ".env.worktree").read_bytes() == first
    assert (root / ".env").resolve() == main / ".env"
    migrations = [kw["env"]["POSTGRES_DB"] for cmd, kw in commands if "alembic" in cmd]
    assert migrations == [db, e2e, db, e2e]
    seeds = [
        kw["env"]["POSTGRES_DB"] for cmd, kw in commands if "app/initial_data.py" in cmd
    ]
    assert seeds == [e2e, e2e]
    assert not (root / ".claude").exists()


def test_failed_migration_does_not_mark_setup_ready(
    trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    root, main = trees
    monkeypatch.setattr(worktree_db, "create", lambda _: True)

    def run(command: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        if "alembic" in command:
            raise subprocess.CalledProcessError(1, command)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(codex.subprocess, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        codex.setup(root, main)
    assert not (root / ".env.worktree").exists()


@pytest.mark.parametrize("mode", ["api", "frontend"])
def test_launch_uses_this_worktree_and_refuses_a_busy_port(
    trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    root, _main = trees
    config = configured(root)
    monkeypatch.chdir(root)
    monkeypatch.setattr(codex, "port_available", lambda _: False)
    with pytest.raises(RuntimeError, match="occupied"):
        codex.launch(root, mode)
    monkeypatch.setattr(codex, "port_available", lambda _: True)
    launched: list[tuple[list[str], dict[str, str], Path]] = []
    monkeypatch.setattr(
        codex.os,
        "execvpe",
        lambda _exe, cmd, env: launched.append((cmd, env, Path.cwd())),
    )
    codex.launch(root, mode)
    command, env, cwd = launched[0]
    if mode == "api":
        assert cwd == root / "backend"
        assert env["POSTGRES_DB"] == config["CODEX_E2E_POSTGRES_DB"]
        assert command[-1] == config["WORKTREE_API_PORT"]
    else:
        assert cwd == root / "frontend"
        assert "--strictPort" in command
        assert env["VITE_API_URL"] == ""
        assert env["PLAYWRIGHT_API_URL"] == config["PLAYWRIGHT_API_URL"]
        assert command[-1] == config["PLAYWRIGHT_DEV_PORT"]


def test_teardown_drops_only_derived_databases(
    trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    root, main = trees
    configured(root)
    monkeypatch.chdir(root)
    monkeypatch.setattr(sys, "argv", ["codex_worktree", "--teardown"])
    monkeypatch.setattr(
        codex,
        "git",
        lambda _root, *args: str(
            root if args[-1] == "--show-toplevel" else main / ".git"
        ),
    )
    dropped: list[str] = []
    monkeypatch.setattr(worktree_db, "drop", dropped.append)
    codex.main()
    assert dropped == list(codex.database_names(root))
    assert not (root / ".env.worktree").exists()


def test_main_checkout_is_refused_before_any_setup(
    trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    _root, main = trees
    monkeypatch.setattr(sys, "argv", ["codex_worktree"])
    monkeypatch.setattr(
        codex,
        "git",
        lambda _root, *args: str(
            main if args[-1] == "--show-toplevel" else main / ".git"
        ),
    )
    with pytest.raises(RuntimeError, match="main checkout"):
        codex.main()
    assert not (main / ".codex-worktree-setup.lock").exists()
