"""Gap detection and post_sync_state persistence for backward sync."""

from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Any, cast

from sqlalchemy import and_
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, delete, select

from app.models_tg import Post, PostSyncState


def _stored_post_ids(
    session: Session, channel_name: str, post_ids: Iterable[int]
) -> set[int]:
    ids = list(post_ids)
    if not ids:
        return set()
    rows = session.exec(
        select(Post.post_id).where(
            Post.channel_name == channel_name,
            col(Post.post_id).in_(ids),
        )
    ).all()
    return set(rows)


def _confirm_gap(
    session: Session,
    *,
    channel_name: str,
    post_id: int,
    job_id: str | None,
) -> None:
    """Record one confirmed gap.

    Took a `user_id` until ticket 22, and wrote it — `tg_post_sync_state` is
    `FOLLOW_SCOPED`, so the stamp said who happened to be syncing when the gap
    was noticed and never decided who could see it. It is dropped here rather
    than ignored: ticket 19 had to guard an ignored `user_id` on
    `upsert_sync_log` because a uniform importer signature required one, and
    nothing requires one on this path. SQLModel drops an unknown keyword
    without complaining, so the four signatures that threaded it here would
    have gone on claiming to record an owner while writing nothing.
    """
    existing = session.exec(
        select(PostSyncState).where(
            PostSyncState.channel_name == channel_name,
            PostSyncState.post_id == post_id,
        )
    ).first()
    if existing:
        return
    session.add(
        PostSyncState(
            channel_name=channel_name,
            post_id=post_id,
            state="confirmed_gap",
            confirmed_at=int(time.time() * 1000),
            confirmed_job_id=job_id,
        )
    )


def _gaps_between_neighbors(
    session: Session,
    *,
    channel_name: str,
    low_id: int,
    high_id: int,
    session_seen_ids: set[int],
    job_id: str | None,
) -> None:
    if high_id <= low_id + 1:
        return
    neighbor_ids = {low_id, high_id}
    if not neighbor_ids.issubset(session_seen_ids):
        return
    stored = _stored_post_ids(session, channel_name, neighbor_ids)
    if not neighbor_ids.issubset(stored):
        return
    for gap_id in range(low_id + 1, high_id):
        _confirm_gap(
            session,
            channel_name=channel_name,
            post_id=gap_id,
            job_id=job_id,
        )


def record_gaps_from_page(
    session: Session,
    channel_name: str,
    page_post_ids: list[int],
    *,
    job_id: str | None,
    session_seen_ids: set[int],
) -> None:
    """Mark confirmed_gap for IDs between visible neighbors on a page fetch."""
    if not page_post_ids:
        return
    session_seen_ids.update(page_post_ids)
    sorted_ids = sorted(page_post_ids)
    for low_id, high_id in zip(sorted_ids, sorted_ids[1:], strict=False):
        _gaps_between_neighbors(
            session,
            channel_name=channel_name,
            low_id=low_id,
            high_id=high_id,
            session_seen_ids=session_seen_ids,
            job_id=job_id,
        )


def record_gaps_to_existing_post(
    session: Session,
    channel_name: str,
    new_post_ids: list[int],
    existing_post_id: int,
    *,
    job_id: str | None,
    session_seen_ids: set[int],
) -> None:
    """On incremental sync, evaluate gaps between new head posts and a known DB post."""
    if not new_post_ids:
        return
    session_seen_ids.add(existing_post_id)
    low_id = min(new_post_ids)
    high_id = existing_post_id
    if low_id > high_id:
        low_id, high_id = high_id, low_id
    _gaps_between_neighbors(
        session,
        channel_name=channel_name,
        low_id=low_id,
        high_id=high_id,
        session_seen_ids=session_seen_ids,
        job_id=job_id,
    )


def clear_channel_sync_state(session: Session, channel_name: str) -> int:
    """Bulk DELETE — one row per confirmed gap, so a long channel has many."""
    result = session.execute(
        sa_delete(PostSyncState).where(col(PostSyncState.channel_name) == channel_name)
    )
    return cast(Any, result).rowcount or 0


def prune_sync_state_below(
    session: Session, channel_name: str, min_post_id: int
) -> int:
    result = session.execute(
        sa_delete(PostSyncState).where(
            col(PostSyncState.channel_name) == channel_name,
            col(PostSyncState.post_id) < min_post_id,
        )
    )
    return cast(Any, result).rowcount or 0


def prune_sync_state_for_post_ids(
    session: Session, channel_name: str, post_ids: list[int]
) -> int:
    if not post_ids:
        return 0
    session.exec(
        delete(PostSyncState).where(
            and_(
                col(PostSyncState.channel_name) == channel_name,
                col(PostSyncState.post_id).in_(post_ids),
            )
        )
    )
    return len(post_ids)
