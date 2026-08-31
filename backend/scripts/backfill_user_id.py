#!/usr/bin/env python3
"""One-off: set user_id to first superuser on TG rows where NULL (Mode A). Idempotent.

**Superseded by ticket 34's migration** (`c0d1e2f3a4b5_backfill_owners_ticket_34`),
which does this for all fourteen user-owned tables on every deploy. What is left
here is the `--reassign-all` mode, which the migration deliberately does not do:
it takes rows that already belong to somebody else. `cleanup_test_channels.py` is
the only caller.

`TABLES` lost `Channel`, `Post`, `PostEmbedding`, `PostTranslation` and `SyncLog`
in ticket 22: those tables are `FOLLOW_SCOPED` in `services/tenancy.SCOPES` and
their owner stamp is dropped, so `col(model.user_id)` on the first of them raised
`AttributeError` and the script failed before touching anything. It is typed now
— `scripts/lint.sh` checks this directory — which is what makes the next such
drop a lint failure rather than a script that dies on its first run.
"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session, SQLModel, col, or_, select

from app.core.db import engine
from app.models_tg import (
    BotCredential,
    ChatDestination,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    PublishLog,
    Summary,
)
from app.services.follows import get_operator_user_id

#: Only tables that still carry an owner. Ticket 22 dropped `user_id` from the
#: follow-scoped ones; naming them here is an `AttributeError`, not a no-op.
TABLES: tuple[type[SQLModel], ...] = (
    Summary,
    BotCredential,
    ChatDestination,
    PublishLog,
    LLMLog,
    EmbeddingLog,
    NetworkLog,
)


def backfill(dry_run: bool = False, reassign_all: bool = False) -> dict[str, int]:
    counts: dict[str, int] = {}
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        if operator_id is None:
            print(
                "ERROR: first superuser not found — run init_db first", file=sys.stderr
            )
            sys.exit(1)

        for model in TABLES:
            name: str = model.__tablename__  # type: ignore[assignment]
            owner = col(model.user_id)  # type: ignore[attr-defined]
            if reassign_all:
                rows = session.exec(
                    select(model).where(or_(owner.is_(None), owner != operator_id))
                ).all()
            else:
                rows = session.exec(select(model).where(owner.is_(None))).all()
            counts[name] = len(rows)
            if not dry_run:
                for row in rows:
                    row.user_id = operator_id
                    session.add(row)
                if rows:
                    session.commit()
            print(
                f"{'[dry-run] ' if dry_run else ''}{name}: {len(rows)} rows to backfill"
            )

    return counts


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    reassign_all = "--reassign-all" in sys.argv
    backfill(dry_run=dry, reassign_all=reassign_all)
