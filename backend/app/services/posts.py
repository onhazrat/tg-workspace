"""Post list and bulk upsert (extracted from data routes)."""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from typing import Any

from sqlalchemy import func, literal, or_, update
from sqlalchemy.orm import aliased
from sqlmodel import Session, col, select

from app.models_tg import Post, utc_now
from app.services.channels import relabel_channels
from app.services.follows import visible_channel_names
from app.services.language import own_words, read_language
from app.services.post_filters import (
    PostFilters,
    apply_analysis_window,
    apply_post_filters,
)
from app.services.serialization import post_to_camel
from app.services.sync_meta import touch_sync
from app.services.tenancy import scoped_select, unscoped_select

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


def _post_reply_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    reply = item.get("replyTo", item.get("reply_to"))
    return reply if isinstance(reply, dict) else None


def _post_int_from_item(item: dict[str, Any], camel: str, snake: str) -> int | None:
    # `isinstance` rather than a truth test: the JSON import path can deliver a
    # string here, and bool is an int subclass.
    value = item.get(camel, item.get(snake))
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def bulk_upsert_posts_impl(
    body: list[dict[str, Any]],
    session: Session,
    *,
    retrieval_job_id: str | None = None,
    retrieval_pass: str | None = None,
    retrieval_source: str | None = None,
    announce_relabels: bool = True,
) -> int:
    count = 0
    now_ms = int(time.time() * 1000)
    touched: set[str] = set()
    for item in body:
        channel = item.get("channelName") or item.get("channel_name", "")
        touched.add(channel)
        post_id = int(item.get("id") or item.get("post_id", 0))
        existing = session.exec(
            select(Post).where(Post.channel_name == channel, Post.post_id == post_id)
        ).first()
        if existing:
            # What the reference extractor reads, captured before the
            # overwrite so an edit that changes a reference can send the row
            # back to extraction. Nothing re-laps the corpus, so without this
            # a channel adding a `t.me` link to an already-extracted Post
            # hides that handle for ever.
            was_referencing = (
                existing.text,
                existing.forwarded_from,
                existing.links,
                existing.reply_to,
            )
            was_words = own_words(existing)
            existing.text = item.get("text", existing.text)
            existing.date = item.get("date", existing.date)
            existing.timestamp = item.get("timestamp", existing.timestamp)
            existing.forwarded_from = item.get("forwardedFrom") or item.get(
                "forwarded_from"
            )
            existing.forwarded_from_name = item.get("forwardedFromName") or item.get(
                "forwarded_from_name"
            )
            existing.reply_to_post_id = _post_int_from_item(
                item, "replyToPostId", "reply_to_post_id"
            )
            # Guarded on the key where the four fields around it are not, and
            # the difference is which payloads carry the key. `post_to_camel`
            # emits a fixed seventeen and CRG-03's column is not among them, so
            # this function — which `POST /data/import` and `/data/posts/bulk`
            # share with the scraper — would take an absent key as "no id" and
            # null the column on every Post an export round trip restored. The
            # href is gone, so nothing could put it back. `forwarded_from` and
            # `reply_to_post_id` are exported, so their unconditional writes
            # restore themselves; this one does not.
            if "forwardedFromPostId" in item or "forwarded_from_post_id" in item:
                existing.forwarded_from_post_id = _post_int_from_item(
                    item, "forwardedFromPostId", "forwarded_from_post_id"
                )
            if "media" in item:
                existing.media = _post_media_from_item(item)
            if "links" in item:
                existing.links = _post_links_from_item(item)
            if "replyTo" in item:
                existing.reply_to = _post_reply_from_item(item)
            # Conditional, and that is the whole point: sync re-scrapes the
            # newest page of every followed Channel on every run, so clearing
            # the flag unconditionally would hand reference extraction
            # thousands of unchanged rows per sync round for ever.
            #
            # `references_extracted` since DDS-02: the harvest queues what the
            # graph holds, so an edit that adds a link reaches the Directory
            # only if extraction reads the Post again. Nothing reads
            # `harvested` any more, and DDS-03 drops it.
            if was_referencing != (
                existing.text,
                existing.forwarded_from,
                existing.links,
                existing.reply_to,
            ):
                existing.references_extracted = False
            # Conditional for the same reason: an unchanged re-scrape is the
            # common case and reading it again would only repeat the answer.
            # An unread Post is read here rather than waiting for the walk.
            words = own_words(existing)
            if existing.language is None or words != was_words:
                existing.language = read_language(words)
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
            post = Post(
                channel_name=channel,
                post_id=post_id,
                text=item.get("text", ""),
                date=item.get("date", ""),
                timestamp=item.get("timestamp", 0),
                forwarded_from=item.get("forwardedFrom") or item.get("forwarded_from"),
                forwarded_from_name=item.get("forwardedFromName")
                or item.get("forwarded_from_name"),
                forwarded_from_post_id=_post_int_from_item(
                    item, "forwardedFromPostId", "forwarded_from_post_id"
                ),
                media=_post_media_from_item(item),
                links=_post_links_from_item(item),
                reply_to_post_id=_post_int_from_item(
                    item, "replyToPostId", "reply_to_post_id"
                ),
                reply_to=_post_reply_from_item(item),
                retrieved_at=now_ms,
                retrieval_job_id=job_id,
                retrieval_pass=pass_val,
                retrieval_source=source,
            )
            # Read on write, and never from the payload: an import's document
            # may carry a Language, but every Language in the deployment comes
            # from the one detector (LANG-01).
            post.language = read_language(own_words(post))
            session.add(post)
        count += 1
    relabel_channels(session, touched, announce=announce_relabels)
    return count


def _unread_page(session: Session, limit: int) -> list[Post]:
    """The newest `limit` Posts nobody has read, through the unread index."""
    return list(
        session.exec(
            unscoped_select(
                select(Post)
                .where(col(Post.language).is_(None))
                .order_by(col(Post.timestamp).desc())
                .limit(limit),
                reason=(
                    "A Post's Language is corpus: read once from its words and "
                    "served to every Follower, so the walk reads every Post."
                ),
            )
        ).all()
    )


def read_unread_languages(session: Session, *, limit: int) -> int:
    """Read one page of Posts stored before LANG-01, newest first (LANG-03).

    One `UPDATE` per Language rather than one per Post. Each keeps
    `language IS NULL` in its predicate, because sync may have edited and read
    one of these Posts since the page was loaded, and its answer is about the
    newer words. Then relabels the Channels the page touched, so the Channels
    tab fills in as the walk proceeds. Commits; returns how many Posts it read,
    so a caught-up tick is one probe of an empty index and no write.
    """
    if limit <= 0:
        return 0
    page = _unread_page(session, limit)
    if not page:
        return 0
    by_language: defaultdict[str, list[uuid.UUID]] = defaultdict(list)
    for post in page:
        by_language[read_language(own_words(post))].append(post.id)
    for language, ids in by_language.items():
        session.execute(
            update(Post)
            .where(col(Post.id).in_(ids), col(Post.language).is_(None))
            .values(language=language)
            .execution_options(synchronize_session=False)
        )
    relabel_channels(session, {post.channel_name for post in page})
    session.commit()
    return len(page)


def random_cap_order(seed: int) -> Any:
    """A deterministic pseudo-random ordering for the ``random`` per-channel cap.

    Public because Discover applies the same cap: sharing the ordering is what
    lets a `random`-capped scope be reproduced server-side, rather than being
    aggregated in the browser (IDEA-011 D14).

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
    user_id: uuid.UUID,
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

    ``user_id`` narrows the read to Channels the caller Follows (ticket 16).
    The predicate goes on ``base``, *before* the ``row_number()`` wrapper
    below, so a capped feed ranks only rows the caller can see — applying it
    outside the subquery would let another account's posts consume the cap.
    """
    base = scoped_select(select(Post), Post, user_id)
    if channel_names:
        base = base.where(col(Post.channel_name).in_(channel_names))
    base = apply_analysis_window(base, start_date, end_date)
    if filters is not None:
        followed: frozenset[str] | None = None
        if filters.forwarded == "unfollowed_forwarded":
            followed = frozenset(visible_channel_names(session, user_id=user_id))
        base = apply_post_filters(base, filters, followed_names=followed)

    if max_per_channel > 0:
        cap_order = (
            random_cap_order(seed)
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
    session: Session, pairs: list[tuple[str, int]], *, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Fetch specific posts by their `(channel_name, post_id)` natural key.

    Exists so callers that need a handful of known posts — citation hovers,
    RAG context assembly — stop pulling a channel's entire history to find
    one row. Unknown pairs are simply absent from the result.

    Duplicate pairs are collapsed, and the batch is expected to be capped by
    the caller (see MAX_POST_LOOKUP_BATCH).

    A post under a Channel the caller does not Follow is absent for the same
    reason an unknown pair is (ticket 16). Dropping it rather than raising is
    deliberate: this endpoint's whole contract is that a missing post is
    silence, so "you may not see this" and "there is nothing here" give the
    same answer — the enumeration argument `assert_owner` makes with a 404.
    """
    unique = {(name, post_id) for name, post_id in pairs}
    if not unique:
        return []
    stmt = scoped_select(select(Post), Post, user_id).where(
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
    user_id: uuid.UUID,
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

    Scoped with the same `user_id` `list_feed` takes, and it has to be: the AI
    paths sum these counts to decide whether a selection fits in one prompt and
    then call `list_feed` to assemble it, so a count over a wider set than the
    feed returns would refuse a selection that would actually have fit.
    """
    count_expr: Any = func.count()
    if max_per_channel > 0:
        count_expr = func.least(count_expr, max_per_channel)

    stmt = scoped_select(select(col(Post.channel_name), count_expr), Post, user_id)
    if channel_names:
        stmt = stmt.where(col(Post.channel_name).in_(channel_names))
    stmt = apply_analysis_window(stmt, start_date, end_date)
    if filters is not None:
        followed: frozenset[str] | None = None
        if filters.forwarded == "unfollowed_forwarded":
            followed = frozenset(visible_channel_names(session, user_id=user_id))
        stmt = apply_post_filters(stmt, filters, followed_names=followed)
    stmt = stmt.group_by(col(Post.channel_name))

    return dict(session.exec(stmt).all())


def bulk_upsert_posts(session: Session, body: list[dict[str, Any]]) -> dict[str, int]:
    count = bulk_upsert_posts_impl(body, session)
    session.commit()
    touch_sync(session, "posts")
    return {"upserted": count}
