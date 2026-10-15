"""The relabel script carries ADR-021's revised rule onto rows written before it.

A Channel or Directory entry labelled under the old rule holds `NULL` where the
new one answers `und` or `zxx`. The script re-derives exactly those rows, from
the Posts and samples already stored, so it sends no Telegram Request. Rows are
seeded through the real write paths, then set back to `NULL` as the old rule
left them.

## Watched to fail

* skip the Channels → the Channel stays `NULL`
* skip the Directory → the entry stays `NULL`
* commit on a dry run → the dry-run test sees `zxx`
* read entries with no samples → the sample-less entry is counted
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, update

from app.core.db import engine
from app.models_tg import Channel, DirectoryEntry
from app.services.channel_directory import record_probe_result
from app.services.posts import bulk_upsert_posts_impl
from tests.utils.tenancy import follow_channels

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import relabel_languages  # noqa: E402

CHANNEL = "relabelchan"
HANDLE = "relabel_entry"
UNREAD = "relabel_unread"
PHOTO = {"kinds": ["photo"], "isMediaOnly": True}


def _photo(channel: str, post_id: int) -> dict[str, Any]:
    return {
        "channelName": channel,
        "id": post_id,
        "text": "[photo]",
        "media": PHOTO,
        "date": "2026-09-01T10:00:00+00:00",
        "timestamp": 1_790_000_000_000 + post_id,
    }


def _probe(handle: str, samples: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "displayName": handle,
        "subscribers": 100,
        "samples": samples,
    }


def _seed_as_the_old_rule_left_them() -> None:
    """Plus an entry with no samples, which has nothing read and stays `NULL`."""
    with Session(engine) as session:
        follow_channels(session, CHANNEL)
        bulk_upsert_posts_impl([_photo(CHANNEL, 1), _photo(CHANNEL, 2)], session)
        record_probe_result(
            session, HANDLE, _probe(HANDLE, [_photo(HANDLE, 1), _photo(HANDLE, 2)])
        )
        record_probe_result(session, UNREAD, _probe(UNREAD, []))
        session.exec(
            update(Channel).where(col(Channel.name) == CHANNEL).values(language=None)
        )
        session.exec(
            update(DirectoryEntry)
            .where(col(DirectoryEntry.handle) == HANDLE)
            .values(language=None)
        )
        session.commit()


def _languages() -> tuple[str | None, str | None]:
    with Session(engine) as session:
        channel = session.get(Channel, CHANNEL)
        entry = session.get(DirectoryEntry, HANDLE)
        assert channel is not None and entry is not None
        return channel.language, entry.language


def test_a_dry_run_counts_the_rows_and_writes_nothing() -> None:
    _seed_as_the_old_rule_left_them()
    assert relabel_languages.relabel(dry_run=True, batch_size=1) == (1, 1)
    assert _languages() == (None, None)


def test_a_run_relabels_both_and_a_second_changes_nothing() -> None:
    _seed_as_the_old_rule_left_them()
    assert relabel_languages.relabel(dry_run=False, batch_size=1) == (1, 1)
    assert _languages() == ("zxx", "zxx")
    with Session(engine) as session:
        unread = session.get(DirectoryEntry, UNREAD)
        assert unread is not None and unread.language is None
    assert relabel_languages.relabel(dry_run=False, batch_size=1) == (0, 0)
