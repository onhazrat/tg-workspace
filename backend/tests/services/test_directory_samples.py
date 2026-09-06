"""A Directory entry keeps a sample of the Channel's recent Posts (ticket 02).

Driven through the **probe write path**, which the spec names as the seam for
everything about what a Directory entry stores. `record_probe_result` has one
production caller — `jobs/discover_probe.py`, which fetches, flags and calls —
so the job itself is glue and this is where the behaviour lives.

Everything asserted here is what a caller can observe: what an entry holds
after a probe, and what survives a recheck. Nothing asserts a column layout or
a call order, because the table it would pin is exactly the kind this spec has
already renamed once.

## Watched to fail

Per `CLAUDE.md`, each assertion was mutation-tested:

* store samples unconditionally (`payload.get("samples") or []`) → the
  no-key test fails, because a metadata-only fetch wipes the snapshot
* merge instead of replace (drop the `DELETE`) → the sliding-window test
  fails, and the unavailable test fails with it
* clear samples in `requeue_probes` → the recheck test fails
* store samples on the inconclusive branch → the inconclusive test fails
* let `replace_samples` commit → nothing fails, which is why the
  transaction rule is asserted directly rather than through the write path
"""

from __future__ import annotations

import ast
import pathlib
from datetime import timedelta
from typing import Any

from sqlmodel import Session

from app.core.db import engine
from app.models_tg import utc_now
from app.services.channel_directory import (
    record_probe_result,
    requeue_probes,
)
from app.services.channel_directory_samples import (
    expire_samples_before,
    replace_samples,
    samples_for,
)

HANDLE = "sample_news"


def _post(post_id: int, **extra: Any) -> dict[str, Any]:
    """One parsed Post, shaped as `_parse_posts_from_html` builds them."""
    return {
        "id": post_id,
        "text": f"post {post_id}",
        "date": "2026-09-01T10:00:00+00:00",
        "timestamp": 1_756_720_800_000 + post_id,
        "channelName": HANDLE,
        **extra,
    }


def _page(
    *, samples: list[dict[str, Any]] | None = None, **extra: Any
) -> dict[str, Any]:
    """A conclusive `get_channel_info` payload."""
    payload: dict[str, Any] = {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "displayName": "Sample News",
        "subscribers": "12.3K",
        **extra,
    }
    if samples is not None:
        payload["samples"] = samples
    return payload


def _ids(session: Session, handle: str = HANDLE) -> list[int]:
    return [row.post_id for row in samples_for(session, handle)]


# --------------------------------------------------------------------------
# A conclusive probe stores what it fetched
# --------------------------------------------------------------------------


def test_a_conclusive_probe_stores_the_samples_it_parsed() -> None:
    """The point of the ticket: the preview page's Posts stop being discarded."""
    with Session(engine) as session:
        record_probe_result(
            session, HANDLE, _page(samples=[_post(11), _post(12), _post(13)])
        )
        assert _ids(session) == [13, 12, 11]


def test_a_sample_carries_the_view_and_reaction_counts_it_was_parsed_with() -> None:
    """The counters ride inside the media block, so keeping media keeps them.

    An Operator judging a Channel wants to know whether anybody reads it, which
    is the whole reason the media block travels rather than the text alone.
    """
    media = {
        "type": "photo",
        "url": "https://cdn.telegram.example/x.jpg",
        "views": "9.7K",
        "viewsCount": 9700,
        "reactions": "12 👍",
        "reactionsCount": 12,
    }
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[_post(11, media=media)]))
        stored = samples_for(session, HANDLE)

    assert stored[0].media is not None
    assert stored[0].media["viewsCount"] == 9700
    assert stored[0].media["reactionsCount"] == 12


def test_a_sample_never_points_at_a_thumbnail_we_did_not_download() -> None:
    """A probe fills no thumb cache, so a local path here renders as broken.

    The parser's rewrite is skipped for samples (`get_channel_info`), and this
    pins the consequence at the storage end: whatever URL the page carried is
    what is stored.
    """
    remote = "https://cdn.telegram.example/thumb.jpg"
    with Session(engine) as session:
        record_probe_result(
            session,
            HANDLE,
            _page(samples=[_post(11, media={"type": "video", "thumbUrl": remote})]),
        )
        stored = samples_for(session, HANDLE)

    assert stored[0].media is not None
    assert "thumbApiPath" not in stored[0].media
    assert stored[0].media["thumbUrl"] == remote


# --------------------------------------------------------------------------
# Replace, and the three things that are not a replace
# --------------------------------------------------------------------------


def test_a_second_probe_drops_a_post_that_fell_off_the_preview_window() -> None:
    """The page is a sliding window, so a merge would report a stale Post as recent."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[_post(11), _post(12)]))
        record_probe_result(session, HANDLE, _page(samples=[_post(12), _post(13)]))
        assert _ids(session) == [13, 12], (
            "the snapshot is replaced wholesale: post 11 is no longer on the "
            "preview page, so it is no longer a recent Post"
        )


def test_a_payload_with_no_samples_key_leaves_the_snapshot_untouched() -> None:
    """A fetch that never parsed Posts is not a fetch that found none.

    This is the distinction the whole write path turns on, and it becomes
    load-bearing when sync starts feeding the Directory: sync fetches exactly
    this metadata and never parses samples, so treating a missing key as an
    empty set would blank every followed Channel's snapshot on every sync.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[_post(11), _post(12)]))
        record_probe_result(session, HANDLE, _page(displayName="Renamed"))

        assert _ids(session) == [12, 11]
        # And the fetch was still recorded — this is not "the write was skipped".
        assert record_probe_result(session, HANDLE, _page())["displayName"] is not None


def test_an_inconclusive_fetch_touches_neither_the_columns_nor_the_samples() -> None:
    """The existing verdict rule, extended to the snapshot it hangs beside.

    A timeout or a proxy block page is not evidence about the Channel, so
    nothing it could overwrite may be overwritten.

    **The status is on that list from ticket 03 on**, and this assertion moved
    with it. When it was written a resolved handle was never fetched again, so
    the only row that could reach the inconclusive branch had no verdict to
    keep and demoting it to `unknown` cost nothing. Refreshing re-fetches every
    live entry on a window, which put one proxy timeout between a good answer
    and every report that joins it — so the failure is recorded and the verdict
    survives it, exactly as the metadata beside it already did. Asserted from
    the other side in `test_directory_refresh.py`.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[_post(11)]))
        after = record_probe_result(session, HANDLE, None, error="timeout")

        assert after["status"] == "ok", "a failed fetch is not evidence of anything"
        assert after["lastError"] == "timeout", "and the failure is still recorded"
        assert after["subscribers"] == "12.3K", "the metadata survives a failed fetch"
        assert _ids(session) == [11]


def test_an_unavailable_verdict_clears_the_samples() -> None:
    """A handle with no readable feed has no recent Posts, and says so.

    The empty list is what `jobs/discover_probe.py` synthesizes when Telegram
    itself reports no web view — deliberately an empty list rather than an
    absent key, so a handle that just went private stops advertising Posts
    nobody can reach.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[_post(11), _post(12)]))
        after = record_probe_result(
            session,
            HANDLE,
            {"isTelegramPage": True, "isUnavailableOnWebView": True, "samples": []},
        )

        assert after["status"] == "unavailable"
        assert _ids(session) == []


def test_a_recheck_resets_the_verdict_and_keeps_the_samples() -> None:
    """A recheck says the answer is old, not that the snapshot is wrong.

    Clearing here would blank the readable half of the entry for however long
    the queue takes to reach the handle — and the next conclusive probe
    replaces it anyway.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[_post(11), _post(12)]))
        requeue_probes(session, [HANDLE])

        assert _ids(session) == [12, 11]

        record_probe_result(session, HANDLE, _page(samples=[_post(20)]))
        assert _ids(session) == [20]


# --------------------------------------------------------------------------
# The aggregate's own contract
# --------------------------------------------------------------------------


def test_the_writer_does_not_commit_so_the_caller_owns_the_transaction() -> None:
    """Half a probe stored is a verdict beside somebody else's snapshot.

    `record_probe_result` writes the entry and its samples as one unit, which
    only holds while this function leaves the transaction open.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        replace_samples(session, HANDLE, [_post(11)])
        session.rollback()

    with Session(engine) as check:
        assert _ids(check) == [], "an uncommitted sample must not survive a rollback"


def test_samples_expire_on_their_own_window_and_the_entry_does_not() -> None:
    """Directory metadata is cumulative; only the expensive half is collected.

    Measured on when the snapshot was captured, not on the Post's own date, so
    a Channel that went quiet years ago keeps the sample taken of it last week.
    """
    now = utc_now()
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[_post(11), _post(12)]))
        replace_samples(
            session,
            HANDLE,
            [_post(11), _post(12)],
            captured_at=now - timedelta(days=40),
        )
        session.commit()

        deleted = expire_samples_before(session, now - timedelta(days=30))
        session.commit()

        assert deleted == 2
        assert _ids(session) == []
        assert (
            record_probe_result(session, HANDLE, _page())["subscribers"] == "12.3K"
        ), (
            "the entry itself is never collected by age — that would throw the "
            "map away, which is the point of the Directory"
        )


def test_an_old_post_captured_recently_is_not_expired() -> None:
    """The contrast case: a quiet Channel is exactly what a sample is for."""
    now = utc_now()
    ancient = _post(11)
    ancient["timestamp"] = 1_000_000_000_000  # 2001
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[ancient]))
        session.commit()

        assert expire_samples_before(session, now - timedelta(days=30)) == 0
        assert _ids(session) == [11]


# --------------------------------------------------------------------------
# One writer, enforced by construction
# --------------------------------------------------------------------------

_APP = pathlib.Path(__file__).resolve().parents[2] / "app"

#: The module that owns the table, plus the two that are allowed to name the
#: model without writing it: `models_tg` defines it and `tenancy` classifies it.
_SAMPLE_TABLE_WRITERS = frozenset(
    {
        "services/channel_directory_samples.py",
        "models_tg.py",
        "services/tenancy.py",
    }
)


def test_the_sample_table_has_one_writer() -> None:
    """Naming `DirectorySample` outside the aggregate is the rule broken.

    `test_service_kinds.py` records that this module owns the table; that is
    enforcement by declaration. This is enforcement by construction, and it is
    worth having here because the temptation is specific and close by:
    `channel_directory.py` already holds a `Session` and already knows the
    handle, so `session.add(DirectorySample(...))` there is one line away and
    would put the replace-wholesale rule in two places.

    Matches the identifier rather than a constructor call, for the reason
    `test_the_follow_table_has_one_writer` gives: a second writer is at least as
    likely to reach for `delete(DirectorySample)` as for the constructor.
    """
    offenders = []
    for path in sorted(_APP.rglob("*.py")):
        rel = str(path.relative_to(_APP))
        if rel in _SAMPLE_TABLE_WRITERS or rel.startswith("alembic/"):
            continue
        tree = ast.parse(path.read_text())
        if any(
            isinstance(node, ast.Name) and node.id == "DirectorySample"
            for node in ast.walk(tree)
        ):
            offenders.append(rel)

    assert not offenders, (
        f"{sorted(offenders)} name DirectorySample directly. "
        f"`app/services/channel_directory_samples.py` is the aggregate and the "
        f"only writer; go through `replace_samples` so replace-wholesale is "
        f"decided in one place."
    )
