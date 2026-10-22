"""A git worktree's private pytest database and ports: names, creation, removal.

Every worktree shares one Postgres, and pytest truncates every `tg_*` table
after each test. Two worktrees on the shared `app_test` wipe each other's rows
mid-run, which reads as hundreds of unrelated ForeignKeyViolations. So each
worktree gets `app_test_<worktree name>`, created by `scripts/worktree-setup.sh`
and dropped by its `--teardown`.

Only names this module derives are ever dropped: `drop` refuses `app`,
`app_test` and anything without the `app_test_` prefix, because a teardown run
in the wrong directory must not take the dev or shared test database with it.

    uv run python -m scripts.worktree_db name <worktree path>
    uv run python -m scripts.worktree_db ports <worktree path>
    uv run python -m scripts.worktree_db create <database>
    uv run python -m scripts.worktree_db drop <database>
"""

from __future__ import annotations

import re
import sys
import zlib
from pathlib import Path

import psycopg
from psycopg import sql

PREFIX = "app_test_"
# Postgres truncates identifiers past 63 bytes, so two long worktree names
# could otherwise collide silently.
MAX_IDENTIFIER = 63


def database_name(worktree: Path) -> str:
    """`app_test_<worktree directory>`, lowercased, non-alphanumerics as `_`."""
    slug = re.sub(r"[^a-z0-9]+", "_", worktree.resolve().name.lower()).strip("_")
    if not slug:
        raise ValueError(f"cannot derive a database name from {worktree}")
    return (PREFIX + slug)[:MAX_IDENTIFIER]


#: Where a worktree's Playwright dev server listens. Every worktree used to
#: share 5180, and `reuseExistingServer` then ran one worktree's specs against
#: another's code.
DEV_PORTS = range(5200, 5600)
#: Its API sits this far above, for a `launch.json` entry of its own.
API_PORT_OFFSET = 3000


def ports(worktree: Path) -> tuple[int, int]:
    """The worktree's dev server and API ports, the same on every run."""
    digest = zlib.crc32(database_name(worktree).encode())
    dev = DEV_PORTS.start + digest % len(DEV_PORTS)
    return dev, dev + API_PORT_OFFSET


def _check_droppable(name: str) -> None:
    if not name.startswith(PREFIX) or name == PREFIX:
        raise ValueError(
            f"refusing to drop {name!r}: only {PREFIX}<worktree> databases "
            "belong to a worktree"
        )


def _admin_connection() -> psycopg.Connection:
    from app.core.config import settings

    return psycopg.connect(
        host=settings.POSTGRES_SERVER,
        port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASSWORD,
        dbname="postgres",
        autocommit=True,
    )


def exists(name: str) -> bool:
    with _admin_connection() as conn:
        row = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (name,)
        ).fetchone()
    return row is not None


def create(name: str) -> bool:
    """Create the database unless it exists. True when this call created it."""
    if exists(name):
        return False
    with _admin_connection() as conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    return True


def drop(name: str) -> bool:
    """Drop a worktree's database, closing its connections. True when dropped."""
    _check_droppable(name)
    if not exists(name):
        return False
    with _admin_connection() as conn:
        conn.execute(
            sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
        )
    return True


def main(argv: list[str]) -> int:
    commands = {"name", "ports", "create", "drop"}
    if len(argv) != 2 or argv[0] not in commands:
        print(__doc__, file=sys.stderr)  # noqa: T201
        return 2
    command, arg = argv
    if command == "name":
        print(database_name(Path(arg)))  # noqa: T201
    elif command == "ports":
        print(*ports(Path(arg)))  # noqa: T201
    elif command == "create":
        print("created" if create(arg) else "exists")  # noqa: T201
    else:
        print("dropped" if drop(arg) else "absent")  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
