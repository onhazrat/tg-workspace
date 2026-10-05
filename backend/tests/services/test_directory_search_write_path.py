"""Every writer leaves the search document equal to a fresh rebuild (DIR-04, ADR-027).

A search document is derived from a Directory entry and its samples, and it is
rebuilt inside each writer that changes those inputs rather than by a trigger
or a queue. The failure that design invites is a writer that forgets: its
entry moves on and its document keeps answering for what the Channel used to
say. Nothing on screen would show it.

So each case drives one writer through its real entry point, then compares
what is stored with what a rebuild from scratch produces. The rebuild is the
backfill's own walk over an emptied table, which also asserts that the
backfill and the writers build the same thing.

## Watched to fail

Each mutation was applied alone and this module went red:
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import text as sa_text
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import utc_now
from app.services import channel_directory
from app.services.channel_directory import (
    expire_samples,
    index_stale_for_search,
    record_probe_result,
    record_sync_metadata,
    requeue_probes,
)

EN = "The weather was calm today and the market opened quietly in the morning"
RU = "Сегодня в мире много важных новостей о политике и экономике страны"


def _page(name: str, words: str, *, bio: str | None = None) -> dict[str, Any]:
    return {
        "isTelegramPage": True,
        "kind": "channel",
        "displayName": name,
        "bio": bio,
        "samples": [
            {
                "id": i + 1,
                "text": words,
                "date": "2026-10-01T00:00:00+00:00",
                "timestamp": 1_759_000_000_000 + i,
                "channelName": "x",
                "media": {"kinds": [], "caption": words},
            }
            for i in range(10)
        ],
    }


def _stored(session: Session) -> dict[str, tuple[Any, ...]]:
    rows = session.execute(
        sa_text(
            "SELECT handle, ts_config, tsv::text, names, index_version "
            "FROM tg_channel_directory_search"
        )
    ).all()
    return {row[0]: tuple(row[1:]) for row in rows}


def _rebuilt(session: Session) -> dict[str, tuple[Any, ...]]:
    session.execute(sa_text("DELETE FROM tg_channel_directory_search"))
    after = ""
    while handles := index_stale_for_search(session, after=after, limit=2):
        after = handles[-1]
    return _stored(session)


def _seed(session: Session) -> None:
    record_probe_result(session, "ws_en", _page("English One", EN, bio="A bio"))
    record_probe_result(session, "ws_ru", _page("Russkiy", RU))
    record_probe_result(session, "ws_other", _page("Other", EN))


def _probe_again(session: Session) -> None:
    # New words, a new name and a new Language: every input moves.
    record_probe_result(session, "ws_en", _page("Now Russian", RU, bio="Другое"))


def _sync(session: Session) -> None:
    meta = {"isTelegramPage": True, "kind": "channel", "displayName": "Renamed"}
    record_sync_metadata(session, "ws_ru", {**meta, "bio": "Synced bio"})
    session.commit()


def _turns_out_a_bot(session: Session) -> None:
    record_probe_result(session, "ws_other", {"isTelegramPage": True, "kind": "bot"})


def _recheck(session: Session) -> None:
    requeue_probes(session, ["ws_en"])


def _retention(session: Session) -> None:
    session.execute(
        sa_text(
            "UPDATE tg_channel_directory_samples SET captured_at = :old "
            "WHERE handle = 'ws_ru'"
        ),
        {"old": utc_now() - timedelta(days=60)},
    )
    expire_samples(session, utc_now() - timedelta(days=30))
    session.commit()


def _inconclusive(session: Session) -> None:
    record_probe_result(session, "ws_en", None, error="timeout")


WRITERS: dict[str, Callable[[Session], None]] = {
    "a probe result": _probe_again,
    "a metadata sync": _sync,
    "a probe that finds a bot": _turns_out_a_bot,
    "a recheck": _recheck,
    "sample retention": _retention,
    "a failed fetch": _inconclusive,
}


@pytest.mark.parametrize("writer", WRITERS.values(), ids=WRITERS.keys())
def test_after_every_writer_the_stored_document_equals_a_rebuild(
    writer: Callable[[Session], None],
) -> None:
    with Session(engine) as session:
        _seed(session)
        before = _stored(session)
        writer(session)
        after = _stored(session)
        assert after == _rebuilt(session)
        assert after != before or writer is _inconclusive


def test_only_listed_channels_have_a_document() -> None:
    with Session(engine) as session:
        _seed(session)
        _turns_out_a_bot(session)
        _recheck(session)
        assert set(_stored(session)) == {"ws_ru"}


def test_the_document_holds_the_eight_newest_samples() -> None:
    with Session(engine) as session:
        page = _page("Eight", EN)
        for i, sample in enumerate(page["samples"]):
            sample["text"] = sample["media"]["caption"] = f"word{i}"
        record_probe_result(session, "ws_eight", page)
        tsv = _stored(session)["ws_eight"][1]
        # Posts 3 to 10 are the newest eight; 1 and 2 are left out.
        assert "'word9'" in tsv and "'word2'" in tsv
        assert "'word1'" not in tsv and "'word0'" not in tsv


def test_the_backfill_fills_every_entry_once_and_is_safe_to_rerun() -> None:
    with Session(engine) as session:
        _seed(session)
        written = _stored(session)
        session.execute(sa_text("DELETE FROM tg_channel_directory_search"))
        assert len(index_stale_for_search(session, limit=10)) == 3
        assert index_stale_for_search(session, limit=10) == []
        assert _stored(session) == written


def test_a_new_index_version_reindexes_older_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with Session(engine) as session:
        _seed(session)
        monkeypatch.setattr(channel_directory, "SEARCH_INDEX_VERSION", 2)
        assert len(index_stale_for_search(session, limit=10)) == 3
        assert {row[3] for row in _stored(session).values()} == {2}
        assert index_stale_for_search(session, limit=10) == []


def test_a_sample_with_no_words_is_not_indexed() -> None:
    """A captionless photo is stored as "[photo]", which nobody wrote."""
    with Session(engine) as session:
        page = _page("English One", EN)
        page["samples"][-1] |= {"text": "[photo]", "media": {"kinds": ["photo"]}}
        record_probe_result(session, "ws_en", page)
        assert "photo" not in _stored(session)["ws_en"][1]
