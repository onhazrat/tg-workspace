"""A sync records the Walked ranges it read; the check reads them (WR-01, ADR-044).

Every test here drives the seam the spec agreed: Telegram's pages faked at the
sync's page fetch, one Channel's sync run as the Operator, then the verdict of
`POST /data/posts/window-check`. No test reads a range row.

A page asked below id B proves every public Post from its oldest id up to
B - 1; the newest page proves up to its newest id. So an id missing inside a
walk is a Post that does not exist publicly, and a Hole is only the ids
between two walks.
"""

from __future__ import annotations

import asyncio
import importlib.util
import pathlib
import time
import types
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services import sync_orchestrator
from app.services.follows import get_operator_user_id
from app.services.posts import bulk_upsert_posts_impl
from app.services.scraper_jobs import WALK_BACK_KEY, ChannelSyncState, SyncJobState
from app.services.walked_ranges import Span, channel_ranges, record_page
from tests.utils.setting_groups import add_test_channel
from tests.utils.utils import get_superuser_token_headers

URL = f"{settings.API_V1_STR}/data/posts/window-check"
MINUTE = 60_000
HOUR = 60 * MINUTE
NOW = int(time.time() * 1000) // MINUTE * MINUTE
E = NOW - 2 * HOUR
S = E - 8 * HOUR

ITERATION_LIMIT = settings.SCRAPER_ITERATION_LIMIT

#: `before_id` -> the page's Posts as (post id, published at); None is newest.
Pages = dict[int | None, list[tuple[int, int]]]


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


def _owner(session: Session) -> uuid.UUID:
    owner = get_operator_user_id(session)
    assert owner is not None
    return owner


def _channel(session: Session, name: str) -> str:
    channel = add_test_channel(session, name, name=name, user_id=_owner(session))
    return channel.id


def _sync(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    channel_id: str,
    pages: Pages,
    *,
    walk_back_to: int | None = None,
    last: int | None | bool = False,
    pages_allowed: int | None = None,
) -> list[int | None]:
    """Sync the Channel over `pages`; answers the `before_id`s it asked for.

    A page Telegram has not got (a `before_id` absent from `pages`) is empty,
    which is how Telegram answers below a Channel's first Post. The page asked
    below `last` offers no next page instead, so the walk stops short of the
    first Post; `pages_allowed` is the iteration cap.
    """
    asked: list[int | None] = []

    async def fetch(_ctx: Any, *, before_id: int | None, **_kw: Any) -> Any:
        asked.append(before_id)
        posts = pages.get(before_id, [])
        lowest = min((i for i, _ in posts), default=None)
        return {
            "posts": [{"id": i, "text": "p", "timestamp": ts} for i, ts in posts],
            "latestId": max((i for i, _ in pages.get(None, [])), default=0),
            "nextBeforeId": None if last is not False and before_id == last else lowest,
        }

    monkeypatch.setattr(
        settings, "SCRAPER_ITERATION_LIMIT", pages_allowed or ITERATION_LIMIT
    )

    monkeypatch.setattr(sync_orchestrator, "_fetch_one_page", fetch)
    owner = _owner(session)
    metadata = {WALK_BACK_KEY: walk_back_to} if walk_back_to is not None else {}
    ch_state = ChannelSyncState(
        channel_id=channel_id, channel_name=channel_id, metadata=metadata
    )
    job = SyncJobState(
        job_id=f"wr-{uuid.uuid4().hex[:8]}",
        source="test",
        channels={channel_id: ch_state},
        user_id=str(owner),
        sync_mode="auto",
    )
    asyncio.run(sync_orchestrator.sync_single_channel(job, ch_state, user_id=owner))
    assert ch_state.status == "success", ch_state.error
    return asked


def _verdict(
    client: TestClient, headers: dict[str, str], name: str, *, start: int = S
) -> dict[str, Any]:
    response = client.post(
        URL,
        json={
            "channelNames": [name],
            "window": {"mode": "fixed", "start": start, "end": E},
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    (found,) = response.json()["channels"]
    assert found["name"] == name
    return dict(found)


def test_ids_missing_inside_a_walk_are_not_a_hole(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Deleted Posts and album members leave ids Telegram never shows; a walk
    that paged past them proves they hold nothing, so the Channel is Complete.

    **Mutation:** record no range for a page and the Channel reads Incomplete.
    """
    pages: Pages = {
        None: [(50, E + HOUR), (48, S + 5 * HOUR), (47, S + 4 * HOUR)],
        47: [(44, S + 3 * HOUR), (40, S + HOUR)],
        40: [(30, S - HOUR)],
    }
    _sync(session, monkeypatch, _channel(session, "wr_deleted"), pages)

    verdict = _verdict(client, operator, "wr_deleted")

    assert (verdict["reasons"], verdict["stretches"]) == ([], [])
    assert verdict["heldPosts"] == 4


#: A Channel walked whole: its first Post before the Start, its newest after E.
OLD: Pages = {
    None: [(50, S + 6 * HOUR), (49, S + 5 * HOUR)],
    49: [(45, S + 2 * HOUR)],
    45: [(40, S - HOUR)],
}
#: Posts published after E, since an earlier walk read up to 50.
NEW: Pages = {None: [(80, E + 30 * MINUTE), (78, E + 20 * MINUTE)]}


def _walked_before_e(session: Session, name: str) -> str:
    """A Channel an earlier walk read from 50 down to its first Post, 40, at
    `S + 6.5 h`, before E: ids above 50 are unread since. A sync here can only read now,
    after E, so that walk is seeded through the ranges' own writer."""
    cid = _channel(session, name)
    posts = [(50, S + 6 * HOUR), (49, S + 5 * HOUR), (45, S + 2 * HOUR), (40, S - HOUR)]
    for post_id, ts in posts:
        session.add(Post(channel_name=name, post_id=post_id, timestamp=ts))
    record_page(
        session,
        name,
        Span(
            lo_id=40,
            hi_id=50,
            lo_ts=S - HOUR,
            hi_ts=S + 6 * HOUR,
            top_read_at=S + 6 * HOUR + 30 * MINUTE,
            reached_start=True,
        ),
    )
    session.commit()
    return cid


def test_a_walk_cut_short_keeps_its_pages_and_leaves_a_real_hole(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A walk stopped at the iteration cap proves the pages it read, and the
    ids it never reached are a Hole, even under a head read after E.

    **Mutation:** treat a fresh head read as proof of the whole Channel and
    the Hole disappears.
    """
    cid = _walked_before_e(session, "wr_capped")
    _sync(session, monkeypatch, cid, NEW | {78: [(60, S + 8 * HOUR)]}, pages_allowed=1)

    verdict = _verdict(client, operator, "wr_capped")

    assert verdict["reasons"] == ["hole"]
    assert verdict["missingIds"] == 77 - 51 + 1
    assert verdict["stretches"] == [{"kind": "hole", "from": S + 6 * HOUR, "to": E}]


def test_a_sync_jumps_into_a_hole_and_reads_only_its_pages(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After its head pass meets the Posts held, the sync starts at the range
    above the Hole and stops on the page that reaches the range below.

    **Mutation:** skip the hole pass and the Hole stays.
    """
    cid = _walked_before_e(session, "wr_repair")
    _sync(session, monkeypatch, cid, NEW, pages_allowed=1)
    hole_pages = NEW | {
        78: [(60, S + 8 * HOUR), (55, S + 7 * HOUR)],
        55: [(52, S + 7 * HOUR), (50, S + 6 * HOUR)],
    }

    asked = _sync(session, monkeypatch, cid, hole_pages)

    assert asked == [None, 78, 55], "it re-read pages it held, or stopped short"
    verdict = _verdict(client, operator, "wr_repair")
    assert (verdict["reasons"], verdict["missingIds"]) == ([], 0)


def test_a_repair_cut_short_leaves_a_smaller_hole(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The pages a capped repair read are kept: the next one starts lower.

    **Mutation:** record the hole pass's pages nowhere and the Hole keeps its
    size.
    """
    cid = _walked_before_e(session, "wr_shrink")
    _sync(session, monkeypatch, cid, NEW, pages_allowed=1)
    hole_pages = NEW | {78: [(60, S + 8 * HOUR), (55, S + 7 * HOUR)]}

    _sync(session, monkeypatch, cid, hole_pages, pages_allowed=2)

    verdict = _verdict(client, operator, "wr_shrink")
    assert (verdict["reasons"], verdict["missingIds"]) == (["hole"], 54 - 51 + 1)


def test_consecutive_syncs_join_where_they_meet(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A head pass that reaches Posts already held joins the range below,
    because each page proves the ids up to the one it was asked below.

    **Mutation:** a page proves only up to its newest Post, and a Hole opens
    between 66 and 78.
    """
    cid = _walked_before_e(session, "wr_join")
    newer = {
        None: [(80, E + 30 * MINUTE), (78, E + 20 * MINUTE)],
        78: [(66, S + 9 * HOUR), (51, S + 7 * HOUR)],
        51: [(50, S + 6 * HOUR)],
    }

    asked = _sync(session, monkeypatch, cid, newer)

    assert asked == [None, 78, 51]
    assert _verdict(client, operator, "wr_join")["reasons"] == []


def test_the_gate_walks_below_the_lowest_range_to_the_start_and_no_further(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """History short of the Start is read from the lowest range down, never
    from the head (ADR-044), and stops on the page that passes the Start.

    **Mutation:** ignore the Start a gate asked for and the walk runs past it.
    """
    cid = _channel(session, "wr_start")
    young: Pages = {None: [(50, E + HOUR), (45, S + 2 * HOUR)]}
    _sync(session, monkeypatch, cid, young, last=None)
    assert _verdict(client, operator, "wr_start")["reasons"] == ["start"]
    older = young | {
        45: [(40, S + HOUR), (35, S - HOUR)],
        35: [(20, S - 9 * HOUR)],
    }

    asked = _sync(session, monkeypatch, cid, older, walk_back_to=S)

    assert asked == [None, 45], "it re-read held pages, or walked past the Start"
    assert _verdict(client, operator, "wr_start")["reasons"] == []


def test_a_head_read_after_the_newest_post_was_deleted_still_counts(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A head page that no longer shows the newest Post held (deleted on
    Telegram) still proves nothing newer existed when it was read.

    **Mutation:** take the topmost part's read moment when merging and the
    Channel reads not synced to the end.
    """
    cid = _walked_before_e(session, "wr_deleted_top")
    head = {None: [(49, S + 5 * HOUR), (45, S + 2 * HOUR)]}

    _sync(session, monkeypatch, cid, head)

    assert _verdict(client, operator, "wr_deleted_top")["reasons"] == []


def test_an_empty_page_inside_a_hole_claims_no_first_post(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Telegram showing nothing below a range with another range under it
    means the Hole's Posts were deleted, not that the Channel starts there.

    **Mutation:** mark the range holding the id, not only the lowest, and the
    upper range spans the window alone.
    """
    cid = _walked_before_e(session, "wr_empty_hole")
    _sync(session, monkeypatch, cid, NEW, pages_allowed=1)

    _sync(session, monkeypatch, cid, NEW)

    assert _verdict(client, operator, "wr_empty_hole")["reasons"] == ["hole"]


def test_a_gate_leaves_a_hole_below_its_start_alone(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only Holes above the floor are read: the Start a gate asked for, or
    the scrape cutoff.

    **Mutation:** read every Hole and the walk asks for the page below 78.
    """
    cid = _walked_before_e(session, "wr_floor")
    _sync(session, monkeypatch, cid, NEW, pages_allowed=1)

    asked = _sync(session, monkeypatch, cid, NEW, walk_back_to=E + 25 * MINUTE)

    assert asked == [None]


def test_posts_stored_without_a_walk_are_held_but_prove_nothing(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
) -> None:
    """An import's Posts count toward the window but vouch for no neighbour.

    **Mutation:** record a range in the Post writer and the import reads
    Complete.
    """
    _channel(session, "wr_import")
    bulk_upsert_posts_impl(
        [
            {"channelName": "wr_import", "id": i, "timestamp": ts, "date": "d"}
            for i, ts in [(1, S - HOUR), (2, S + HOUR), (3, E + HOUR)]
        ],
        session,
    )
    session.commit()

    verdict = _verdict(client, operator, "wr_import")

    assert verdict["reasons"] == ["end", "start"]
    assert verdict["heldPosts"] == 1


def test_the_sync_stores_the_posting_pace(
    client: TestClient,
    operator: dict[str, str],
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Posts an hour from the first Post held to the head read, stored at the
    sync so the check counts nothing.

    **Mutation:** store no pace and the verdict's pace is None.
    """
    cid = _channel(session, "wr_pace")
    before = int(time.time() * 1000)
    _sync(session, monkeypatch, cid, OLD)
    after = int(time.time() * 1000)

    pace = _verdict(client, operator, "wr_pace")["pacePerHour"]

    hours = (before - (S - HOUR)) / HOUR, (after - (S - HOUR)) / HOUR
    assert 4 / hours[0] >= pace >= 4 / hours[1]


# --- The backfill (the migration) --------------------------------------------------

MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2]
    / "app"
    / "alembic"
    / "versions"
    / "a4d8e2c6f019_walked_ranges_wr_01.py"
)


def _migration() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(MIGRATION.stem, MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_backfill_joins_what_one_job_or_confirmed_gaps_prove(
    session: Session,
) -> None:
    """Consecutive held Posts share a range when no id lies between them, one
    sync job stored both, or every id between is a confirmed gap. Anything
    else stays a Hole. The top range takes the head read, the lowest the first
    Post. The migration's own SQL runs, against a stand-in for the dropped gap
    table, so the test reads what deploy runs.

    **Mutation:** ignore confirmed gaps and 6 to 9 becomes a Hole.
    """
    migration = _migration()
    head = E + HOUR
    add_test_channel(
        session,
        "wr_mig",
        name="wr_mig",
        head_read_at=head,
        history_reached_channel_start=True,
    )
    for post_id, job, ts in [
        (1, "a", S - 3 * HOUR),
        (2, "b", S - 2 * HOUR),  # adjacent: joins whatever the job
        (6, "b", S - HOUR),  # same job: joins
        (9, "c", S),  # 7 and 8 are confirmed gaps: joins
        (12, "d", S + HOUR),  # 10 and 11 unknown, another job: a Hole
        (20, "d", E + HOUR),
    ]:
        session.add(
            Post(
                channel_name="wr_mig",
                post_id=post_id,
                timestamp=ts,
                retrieval_job_id=job,
            )
        )
    session.flush()
    session.execute(
        sa.text(
            "CREATE TEMP TABLE tg_post_sync_state (channel_name text, post_id int)"
            " ON COMMIT DROP"
        )
    )
    session.execute(
        sa.text("INSERT INTO tg_post_sync_state VALUES ('wr_mig', 7), ('wr_mig', 8)")
    )
    for sql in (
        migration.BUILD_RANGES_SQL,
        migration.TOP_READ_SQL,
        migration.REACHED_START_SQL,
        migration.PACE_SQL,
    ):
        session.execute(sa.text(sql))
    session.commit()

    assert channel_ranges(session, "wr_mig") == [
        Span(lo_id=1, hi_id=9, lo_ts=S - 3 * HOUR, hi_ts=S, reached_start=True),
        Span(lo_id=12, hi_id=20, lo_ts=S + HOUR, hi_ts=E + HOUR, top_read_at=head),
    ]
