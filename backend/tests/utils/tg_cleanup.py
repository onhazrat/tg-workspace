"""Pytest helpers for TG table cleanup."""

from __future__ import annotations

import sys
from pathlib import Path

from sqlmodel import Session

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from tg_test_pollution import cleanup_channel_keys, truncate_tg_tables

from app.core.db import engine


def truncate_all_tg_tables() -> None:
    with Session(engine) as session:
        truncate_tg_tables(session)
