"""Prepare and launch Codex worktrees without changing Claude's setup."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import os
import socket
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

from scripts import worktree_db

DEV_PORT_START = 20000
PORT_COUNT = 1000
API_PORT_OFFSET = 10000


def database_names(root: Path) -> tuple[str, str]:
    identity = hashlib.sha256(os.fsencode(root.resolve())).hexdigest()[:16]
    return f"app_test_codex_{identity}", f"app_test_e2e_codex_{identity}"


def read_config(root: Path) -> dict[str, str]:
    path = root / ".env.worktree"
    if not path.exists():
        return {}
    config = {
        key: value
        for key, value in dotenv_values(path, interpolate=False).items()
        if value is not None
    }
    db, e2e = database_names(root)
    if (
        config.get("TEST_POSTGRES_DB") != db
        or config.get("CODEX_E2E_POSTGRES_DB") != e2e
    ):
        raise RuntimeError(f"{path} belongs to another setup; refusing to replace it")
    dev, api = int(config["PLAYWRIGHT_DEV_PORT"]), int(config["WORKTREE_API_PORT"])
    if (
        not DEV_PORT_START <= dev < DEV_PORT_START + PORT_COUNT
        or api != dev + API_PORT_OFFSET
    ):
        raise RuntimeError(f"Invalid Codex ports in {path}")
    if config.get("PLAYWRIGHT_API_URL") != f"http://127.0.0.1:{api}":
        raise RuntimeError(f"Invalid Codex API URL in {path}")
    return config


def port_available(port: int) -> bool:
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def allocate_ports(root: Path) -> tuple[int, int]:
    reserved: set[int] = set()
    for record in git(root, "worktree", "list", "--porcelain", "-z").split("\0"):
        if not record.startswith("worktree "):
            continue
        other = Path(record.removeprefix("worktree "))
        config = dotenv_values(other / ".env.worktree", interpolate=False)
        for key in ("PLAYWRIGHT_DEV_PORT", "WORKTREE_API_PORT"):
            value = config.get(key)
            if value and value.isdecimal():
                reserved.add(int(value))
    start = int(database_names(root)[0].rsplit("_", 1)[1], 16) % PORT_COUNT
    for offset in range(PORT_COUNT):
        dev = DEV_PORT_START + (start + offset) % PORT_COUNT
        api = dev + API_PORT_OFFSET
        if not {dev, api} & reserved and port_available(dev) and port_available(api):
            return dev, api
    raise RuntimeError("No free Codex worktree port pair")


def setup(root: Path, main: Path) -> None:
    config = read_config(root)
    env_path = root / ".env"
    if not env_path.exists():
        if env_path.is_symlink() or not (main / ".env").is_file():
            raise RuntimeError("A readable main-checkout .env is required")
        env_path.symlink_to(main / ".env")
    subprocess.run(["bun", "install", "--frozen-lockfile"], cwd=root, check=True)
    db, e2e = database_names(root)
    for name in (db, e2e):
        worktree_db.create(name)
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=root / "backend",
            env={**os.environ, "POSTGRES_DB": name},
            check=True,
        )
    subprocess.run(
        [sys.executable, "app/initial_data.py"],
        cwd=root / "backend",
        env={**os.environ, "POSTGRES_DB": e2e},
        check=True,
    )
    dev, api = (
        (int(config["PLAYWRIGHT_DEV_PORT"]), int(config["WORKTREE_API_PORT"]))
        if config
        else allocate_ports(root)
    )
    path = root / ".env.worktree"
    temporary = path.with_name(".env.worktree.tmp")
    temporary.write_text(
        f"TEST_POSTGRES_DB={db}\nCODEX_E2E_POSTGRES_DB={e2e}\n"
        f"PLAYWRIGHT_DEV_PORT={dev}\nWORKTREE_API_PORT={api}\n"
        f"PLAYWRIGHT_API_URL=http://127.0.0.1:{api}\n"
    )
    temporary.replace(path)
    print(f"Ready: pytest={db}; API={e2e} on :{api}; frontend on :{dev}")  # noqa: T201


def launch(root: Path, mode: str) -> None:
    config = read_config(root)
    if not config:
        raise RuntimeError("Run bash scripts/codex-worktree-setup.sh first")
    key = "WORKTREE_API_PORT" if mode == "api" else "PLAYWRIGHT_DEV_PORT"
    port = config[key]
    # shortcut: external apps can claim a reserved port later; fail at launch rather than reuse it.
    if not port_available(int(port)):
        raise RuntimeError(f"Port {port} is occupied; stop its server before launching")
    env = {**os.environ, **config, "ENVIRONMENT": "local", "VITE_API_URL": ""}
    if mode == "api":
        env["POSTGRES_DB"] = config["CODEX_E2E_POSTGRES_DB"]
        os.chdir(root / "backend")
        command = [sys.executable, "-m", "fastapi", "run", "app/main.py"]
    else:
        os.chdir(root / "frontend")
        command = ["bun", "run", "dev", "--strictPort"]
    os.execvpe(command[0], [*command, "--host", "127.0.0.1", "--port", port], env)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    for mode in ("api", "frontend", "teardown"):
        modes.add_argument(f"--{mode}", dest="mode", action="store_const", const=mode)
    mode = parser.parse_args().mode
    root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel")).resolve()
    main_root = Path(
        git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).parent
    if root == main_root:
        raise RuntimeError(
            "This command requires a linked worktree, not the main checkout"
        )
    if mode in ("api", "frontend"):
        launch(root, mode)
        return
    # Serialise setup and port reservations across Codex worktrees of this repository.
    with (main_root / ".codex-worktree-setup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if mode == "teardown":
            read_config(root)
            for name in database_names(root):
                worktree_db.drop(name)
            (root / ".env.worktree").unlink(missing_ok=True)
        else:
            setup(root, main_root)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as exc:
        sys.exit(f"Codex worktree setup failed: {exc}")
