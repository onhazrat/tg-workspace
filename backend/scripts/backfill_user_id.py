#!/usr/bin/env python3
"""One-off: set user_id to first superuser on TG rows where NULL (Mode A). Idempotent."""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

from sqlmodel import Session, col, or_, select

from app.core.db import engine
from app.models_tg import (
    BotCredential,
    Channel,
    ChatDestination,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    Summary,
    SyncLog,
)
from app.services.operator import get_operator_user_id

TABLES = (
    Channel,
    Post,
    Summary,
    BotCredential,
    ChatDestination,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    SyncLog,
    LLMLog,
    EmbeddingLog,
    NetworkLog,
)


def backfill(dry_run: bool = False, reassign_all: bool = False) -> dict[str, int]:
    counts: dict[str, int] = {}
    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        if operator_id is None:
            print("ERROR: first superuser not found — run init_db first", file=sys.stderr)
            sys.exit(1)

        for model in TABLES:
            name = model.__tablename__  # type: ignore[attr-defined]
            if reassign_all:
                rows = session.exec(
                    select(model).where(  # type: ignore[attr-defined]
                        or_(
                            col(model.user_id).is_(None),  # type: ignore[attr-defined]
                            col(model.user_id) != operator_id,  # type: ignore[attr-defined]
                        )
                    )
                ).all()
            else:
                rows = session.exec(
                    select(model).where(col(model.user_id).is_(None))  # type: ignore[attr-defined]
                ).all()
            counts[name] = len(rows)
            if not dry_run:
                for row in rows:
                    row.user_id = operator_id
                    session.add(row)
                if rows:
                    session.commit()
            print(f"{'[dry-run] ' if dry_run else ''}{name}: {len(rows)} rows to backfill")

    return counts


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    reassign_all = "--reassign-all" in sys.argv
    backfill(dry_run=dry, reassign_all=reassign_all)
