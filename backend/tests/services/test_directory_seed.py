"""The Directory launches knowing every Channel anyone follows (ticket 01).

An empty Directory on upgrade would be wrong twice over. It would spend weeks of
probe requests rediscovering handles the deployment already holds current
metadata for, and until it did, the map would omit exactly the Channels most
likely to be looked at first — the ones people actually follow.

These tests execute the migration's own statement rather than a copy of it. A
copy is a test that passes while the thing that runs on deploy does something
else, which is the failure mode `test_owner_backfill.py` documents at length.
"""

from __future__ import annotations

import importlib.util
import pathlib
import types
from collections.abc import Iterator
from typing import Any

import pytest
import sqlalchemy as sa
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import Channel, DirectoryEntry
from app.services.channel_directory import (
    handles_needing_probe,
    probe_map,
    record_probe_result,
)

MIGRATION_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app"
    / "alembic"
    / "versions"
    / "b1c2d3e4f5a6_the_channel_directory.py"
)


def load_migration() -> types.ModuleType:
    """Import the revision file directly — `versions/` is not a package."""
    spec = importlib.util.spec_from_file_location("directory_seed", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


def _seed(session: Session) -> None:
    seed_sql: str = load_migration().SEED_FROM_CHANNELS_SQL
    session.connection().execute(sa.text(seed_sql))
    session.commit()


def _channel(name: str, **fields: Any) -> Channel:
    """`id` and `name` are the same string here, as every creation path sets them.

    `last_updated` defaults to a real value because the seed only claims `ok`
    for a Channel that has actually been synced. A test about the unsynced case
    passes `last_updated=None` explicitly, which is the point of that test.
    """
    fields.setdefault("last_updated", 1000)
    return Channel(id=name, name=name, **fields)


def test_a_followed_channel_becomes_a_directory_entry(session: Session) -> None:
    session.add(
        _channel(
            "alpha_news",
            display_name="Alpha News",
            subscribers="12.3K",
            photos="1.2K",
            videos="340",
            files="12",
            links="5.6K",
            telegram_chat_id=1234567890123,
        )
    )
    session.commit()

    _seed(session)

    row = session.get(DirectoryEntry, "alpha_news")
    assert row is not None
    assert row.display_name == "Alpha News"
    assert row.subscribers == "12.3K"
    assert row.photos == "1.2K"
    assert row.videos == "340"
    assert row.files == "12"
    assert row.links == "5.6K"
    assert row.telegram_chat_id == 1234567890123


def test_a_seeded_entry_reads_as_a_followable_channel(session: Session) -> None:
    """A Channel that has been synced is by construction one we can scrape.

    That is exactly what the `ok`/`channel` verdict asserts, so seeding it is a
    statement of fact rather than an optimistic default — and it keeps the
    seeded handle out of the probe queue, which reads `unknown` as pending.
    """
    session.add(_channel("beta_daily"))
    session.commit()

    _seed(session)

    row = session.get(DirectoryEntry, "beta_daily")
    assert row is not None
    assert row.status == "ok"
    assert row.kind == "channel"
    assert row.attempts == 0
    assert row.last_error is None


def test_the_handle_is_normalized_like_every_other_key(session: Session) -> None:
    """`tg_channels` stores the name as typed; the Directory keys on lowercase.

    Seeding without folding the case would make `Alpha_News` a second row that
    no probe or report lookup would ever find, since both normalize first.
    """
    session.add(_channel("Alpha_News"))
    session.commit()

    _seed(session)

    assert session.get(DirectoryEntry, "alpha_news") is not None
    assert session.get(DirectoryEntry, "Alpha_News") is None


def test_seeding_never_overwrites_a_probe_verdict(session: Session) -> None:
    """The probe looked at the live page; the Channel row is whatever sync left.

    A followed handle can already have been probed — reports probe candidates
    regardless of who follows them. The probe's answer is the more recent and
    more direct of the two, so the seed must yield to it rather than stamp a
    manufactured `ok` over a real verdict.
    """
    record_probe_result(
        session,
        "gamma_wire",
        {
            "isTelegramPage": True,
            "isUnavailableOnWebView": True,
            "kind": "bot",
            "displayName": "Gamma Bot",
        },
    )
    session.add(_channel("gamma_wire", display_name="Gamma Wire"))
    session.commit()

    _seed(session)

    row = session.get(DirectoryEntry, "gamma_wire")
    assert row is not None
    assert row.status == "unavailable"
    assert row.kind == "bot"
    assert row.display_name == "Gamma Bot"


def test_seeding_twice_is_a_no_op(session: Session) -> None:
    """The seed runs inside a migration, and a migration can be re-run in test."""
    session.add(_channel("delta_post"))
    session.commit()

    _seed(session)
    _seed(session)

    count = (
        session.connection()
        .execute(
            sa.text(
                "SELECT count(*) FROM tg_channel_directory WHERE handle = 'delta_post'"
            )
        )
        .scalar_one()
    )
    assert count == 1


def test_a_seeded_entry_is_visible_to_the_read_time_join(session: Session) -> None:
    """`probe_map` filters on `attempted_at IS NOT NULL`.

    Without the timestamps a seeded row is stranded: `ok` is conclusive so the
    queue skips it forever, while the join hides it, and every byte of metadata
    this seed exists to carry reaches no reader.
    """
    session.add(_channel("epsilon_feed", display_name="Epsilon"))
    session.commit()

    _seed(session)

    joined = probe_map(session, {"epsilon_feed"})
    assert "epsilon_feed" in joined
    assert joined["epsilon_feed"]["displayName"] == "Epsilon"


def test_a_seeded_entry_is_not_queued_for_probing(session: Session) -> None:
    """A conclusive verdict is what keeps the upgrade from re-probing the corpus."""
    session.add(_channel("zeta_news"))
    session.commit()

    _seed(session)

    assert handles_needing_probe(session, ["zeta_news"]) == []


def test_a_channel_that_never_synced_is_not_given_a_verdict(session: Session) -> None:
    """A `tg_channels` row is not evidence the handle can be scraped.

    Following a restricted or frozen handle still creates the Channel — it is
    filed under the restricted setting group rather than refused. Seeding `ok`
    for it would manufacture a conclusive verdict the queue can never correct,
    since only a manual recheck reopens one.
    """
    session.add(_channel("eta_locked", last_updated=None))
    session.commit()

    _seed(session)

    assert session.get(DirectoryEntry, "eta_locked") is None
    # And it stays answerable the ordinary way.
    assert handles_needing_probe(session, ["eta_locked"]) == ["eta_locked"]


def test_an_at_prefixed_name_seeds_under_the_normalized_handle(
    session: Session,
) -> None:
    """`normalize_handle` is `lstrip("@").strip().lower()`, not just lowercase."""
    session.add(_channel("@Theta_Wire "))
    session.commit()

    _seed(session)

    assert session.get(DirectoryEntry, "theta_wire") is not None
