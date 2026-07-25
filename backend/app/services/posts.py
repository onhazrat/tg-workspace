"""Post list and bulk upsert (extracted from data routes)."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import func, literal, or_
from sqlalchemy.orm import aliased
from sqlmodel import Session, col, select

from app.models_tg import Channel, Post, utc_now
from app.services.post_filters import PostFilters, apply_post_filters
from app.services.serialization import post_to_camel
from app.services.sync_meta import touch_sync

DEFAULT_POST_PAGE_SIZE = 500
MAX_POST_PAGE_SIZE = 5000
MAX_POST_LOOKUP_BATCH = 200

FEED_SORTS: frozenset[str] = frozenset({"time", "channel_time"})
FEED_CAP_MODES: frozenset[str] = frozenset({"latest", "random"})


def _post_media_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    media = item.get("media")
    return media if isinstance(media, dict) else None


def _post_links_from_item(item: dict[str, Any]) -> list[Any] | None:
    links = item.get("links")
    return links if isinstance(links, list) else None


def bulk_upsert_posts_impl(
    body: list[dict[str, Any]],
    session: Session,
    *,
    retrieval_job_id: str | None = None,
    retrieval_pass: str | None = None,
    retrieval_source: str | None = None,
) -> int:
    count = 0
    now_ms = int(time.time() * 1000)
    for item in body:
        channel = item.get("channelName") or item.get("channel_name", "")
        post_id = int(item.get("id") or item.get("post_id", 0))
        existing = session.exec(
            select(Post).where(Post.channel_name == channel, Post.post_id == post_id)
        ).first()
        if existing:
            existing.text = item.get("text", existing.text)
            existing.date = item.get("date", existing.date)
            existing.timestamp = item.get("timestamp", existing.timestamp)
            existing.forwarded_from = item.get("forwardedFrom") or item.get(
                "forwarded_from"
            )
            existing.forwarded_from_name = item.get("forwardedFromName") or item.get(
                "forwarded_from_name"
            )
            if "media" in item:
                existing.media = _post_media_from_item(item)
            if "links" in item:
                existing.links = _post_links_from_item(item)
            existing.updated_at = utc_now()
            session.add(existing)
        else:
            job_id = (
                item.get("retrievalJobId")
                or item.get("retrieval_job_id")
                or retrieval_job_id
            )
            pass_val = (
                item.get("retrievalPass")
                or item.get("retrieval_pass")
                or retrieval_pass
            )
            source = (
                item.get("retrievalSource")
                or item.get("retrieval_source")
                or retrieval_source
            )
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=item.get("text", ""),
                    date=item.get("date", ""),
                    timestamp=item.get("timestamp", 0),
                    forwarded_from=item.get("forwardedFrom")
                    or item.get("forwarded_from"),
                    forwarded_from_name=item.get("forwardedFromName")
                    or item.get("forwarded_from_name"),
                    media=_post_media_from_item(item),
                    links=_post_links_from_item(item),
                    retrieved_at=now_ms,
                    retrieval_job_id=job_id,
                    retrieval_pass=pass_val,
                    retrieval_source=source,
                )
            )
        count += 1
    return count


def _random_cap_order(seed: int) -> Any:
    """A deterministic pseudo-random ordering for the ``random`` per-channel cap.

    Seeded by the scope (channel, post, and a caller-supplied ``seed``) so the
    *same* posts are chosen across pages — offset paging over a per-request
    reshuffle (``ORDER BY random()``) would repeat and skip rows. It does not
    reproduce the old client-side mulberry32 shuffle; the user only requires a
    stable random selection, not byte-parity with the previous frontend cap.
    """
    return func.md5(
        func.concat(
            col(Post.channel_name),
            literal(":"),
            col(Post.post_id),
            literal(f":{seed}"),
        )
    )


def _feed_order_by(sort: str, entity: Any) -> list[Any]:
    """Deterministic ORDER BY for the feed, with a stable tiebreak for paging.

    ``time`` is global newest-first; ``channel_time`` groups by channel then
    newest-first. ``(channel_name, post_id)`` is unique, so adding it as a
    tiebreak makes offset paging stable even when timestamps collide.
    """
    timestamp = entity.timestamp
    channel_name = entity.channel_name
    post_id = entity.post_id
    if sort == "channel_time":
        return [channel_name.asc(), timestamp.desc(), post_id.desc()]
    return [timestamp.desc(), channel_name.asc(), post_id.desc()]


def list_feed(
    session: Session,
    *,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
    filters: PostFilters | None = None,
    max_per_channel: int = 0,
    max_per_channel_mode: str = "latest",
    sort: str = "time",
    seed: int = 0,
    limit: int = DEFAULT_POST_PAGE_SIZE,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """One page of the Posts feed, filtered / capped / sorted entirely in SQL.

    Replaces the frontend's eager ``filteredPosts`` for the Posts tab: rather
    than paging a channel's whole history into the browser and filtering there,
    the keyword / forwarded / media filters, the per-channel cap, and the sort
    all run server-side and only ``limit`` rows are returned. With no filters,
    no cap, and ``sort="time"`` this is a newest-first page.

    The read stays bounded: ``tg_posts`` holds millions of rows across hundreds
    of channels, and an unbounded select here materialised gigabytes into a
    worker — the root cause of the staging incident. The ``ORDER BY`` always
    ends in ``(channel_name, post_id)`` so offset paging is deterministic (a
    non-deterministic order silently repeats and skips rows across pages).
    """
    base = select(Post)
    if channel_names:
        base = base.where(col(Post.channel_name).in_(channel_names))
    if start_date is not None:
        base = base.where(Post.timestamp >= start_date)
    if end_date is not None:
        base = base.where(Post.timestamp <= end_date)
    if filters is not None:
        followed: frozenset[str] | None = None
        if filters.forwarded == "unfollowed_forwarded":
            followed = frozenset(
                name.lower() for name in session.exec(select(Channel.name)).all()
            )
        base = apply_post_filters(base, filters, followed_names=followed)

    if max_per_channel > 0:
        cap_order = (
            _random_cap_order(seed)
            if max_per_channel_mode == "random"
            else col(Post.timestamp).desc()
        )
        row_number = (
            func.row_number()
            .over(partition_by=col(Post.channel_name), order_by=cap_order)
            .label("rn")
        )
        ranked = base.add_columns(row_number).subquery()
        capped = aliased(Post, ranked)
        stmt = (
            select(capped)
            .where(ranked.c.rn <= max_per_channel)
            .order_by(*_feed_order_by(sort, capped))
            .offset(offset)
            .limit(limit)
        )
        return [post_to_camel(p) for p in session.exec(stmt).all()]

    stmt = base.order_by(*_feed_order_by(sort, Post)).offset(offset).limit(limit)
    return [post_to_camel(p) for p in session.exec(stmt).all()]


def lookup_posts(
    session: Session, pairs: list[tuple[str, int]]
) -> list[dict[str, Any]]:
    """Fetch specific posts by their `(channel_name, post_id)` natural key.

    Exists so callers that need a handful of known posts — citation hovers,
    RAG context assembly — stop pulling a channel's entire history to find
    one row. Unknown pairs are simply absent from the result.

    Duplicate pairs are collapsed, and the batch is expected to be capped by
    the caller (see MAX_POST_LOOKUP_BATCH).
    """
    unique = {(name, post_id) for name, post_id in pairs}
    if not unique:
        return []
    stmt = select(Post).where(
        or_(
            *[
                (col(Post.channel_name) == name) & (col(Post.post_id) == post_id)
                for name, post_id in unique
            ]
        )
    )
    return [post_to_camel(p) for p in session.exec(stmt).all()]


def count_posts_in_scope(
    session: Session,
    *,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
    filters: PostFilters | None = None,
    max_per_channel: int = 0,
) -> dict[str, int]:
    """Per-channel post counts for a filtered scope, as a `GROUP BY` in SQL.

    Replaces the frontend's `buildPostsInScopeCounts`, which tallied the fully
    fetched, client-filtered post array. Applies the same keyword / forwarded /
    media filters as Discover so the two agree.

    `max_per_channel` clamps each channel's count to the cap. The cap's
    `random` and `latest` modes select *different* posts but the same *number*
    per channel, so a count is mode-independent and needs no client fallback.
    """
    count_expr: Any = func.count()
    if max_per_channel > 0:
        count_expr = func.least(count_expr, max_per_channel)

    stmt = select(col(Post.channel_name), count_expr)
    if channel_names:
        stmt = stmt.where(col(Post.channel_name).in_(channel_names))
    if start_date is not None:
        stmt = stmt.where(Post.timestamp >= start_date)
    if end_date is not None:
        stmt = stmt.where(Post.timestamp <= end_date)
    if filters is not None:
        followed: frozenset[str] | None = None
        if filters.forwarded == "unfollowed_forwarded":
            followed = frozenset(
                name.lower() for name in session.exec(select(Channel.name)).all()
            )
        stmt = apply_post_filters(stmt, filters, followed_names=followed)
    stmt = stmt.group_by(col(Post.channel_name))

    return dict(session.exec(stmt).all())


def bulk_upsert_posts(session: Session, body: list[dict[str, Any]]) -> dict[str, int]:
    count = bulk_upsert_posts_impl(body, session)
    session.commit()
    touch_sync(session, "posts")
    return {"upserted": count}
