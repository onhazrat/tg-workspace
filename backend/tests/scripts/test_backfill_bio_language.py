"""The Bio language backfill catches the Directory up with ADR-048 (PRF-01).

A readable Channel's stored Bio gets its Bio language with no Request; a
group, bot, user or Hidden Channel probed before PRF-01 lost its Bio and photo,
so it is Rechecked. Rows are seeded through the real write path, then set back
to an unset Bio language as the code before PRF-01 left them.

## Watched to fail

* select every unread entry for the Recheck -> the `unknown` entry is requeued
* read only the Bios that are not empty -> the empty Bio stays unset
* write on a dry run -> the dry run sees a Bio language
* select by kind alone -> the Hidden Channel is never Rechecked
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, update

from app.core.db import engine
from app.models_tg import DirectoryEntry
from app.services.channel_directory import record_probe_result

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import backfill_bio_language  # noqa: E402

BOT_BIO = "BotFather is the one bot to rule them all. Use it to manage your bots."


def _page(kind: str, **extra: Any) -> dict[str, Any]:
    return {
        "isTelegramPage": True,
        "isUnavailableOnWebView": kind != "channel",
        "kind": kind,
        "samples": [],
        **extra,
    }


ENTRIES: dict[str, dict[str, Any]] = {
    "bf_readable": _page("channel", bio=BOT_BIO),
    "bf_readable_no_bio": _page("channel"),
    "bf_bot": _page("bot", bio=BOT_BIO),
    "bf_user": _page("user"),
    "bf_hidden": _page("channel", isPrivate=True),
    "bf_unknown": _page("unknown"),
}


def _seed_as_before_prf_01() -> None:
    with Session(engine) as session:
        for handle, page in ENTRIES.items():
            record_probe_result(session, handle, page)
        session.exec(
            update(DirectoryEntry)
            .where(col(DirectoryEntry.handle).in_(ENTRIES))
            .values(bio_language=None)
        )
        # One probed since PRF-01: it has its profile, so it is not Rechecked.
        record_probe_result(session, "bf_bot_since", _page("bot", bio=BOT_BIO))
        session.commit()


def _state() -> dict[str, tuple[str, str | None]]:
    with Session(engine) as session:
        return {
            handle: (row.status, row.bio_language)
            for handle in [*ENTRIES, "bf_bot_since"]
            if (row := session.get(DirectoryEntry, handle)) is not None
        }


def test_a_dry_run_counts_both_steps_and_writes_nothing() -> None:
    _seed_as_before_prf_01()
    before = _state()
    assert backfill_bio_language.backfill(dry_run=True, batch_size=1) == (2, 3)
    assert _state() == before


def test_a_run_reads_stored_bios_and_rechecks_the_dropped_profiles() -> None:
    _seed_as_before_prf_01()
    assert backfill_bio_language.backfill(dry_run=False, batch_size=1) == (2, 3)

    assert _state() == {
        "bf_readable": ("ok", "en"),
        "bf_readable_no_bio": ("ok", "zxx"),
        "bf_bot": ("unknown", None),
        "bf_user": ("unknown", None),
        "bf_hidden": ("unknown", None),
        "bf_unknown": ("unavailable", None),
        "bf_bot_since": ("unavailable", "en"),
    }
    assert backfill_bio_language.backfill(dry_run=False, batch_size=1) == (0, 0)
