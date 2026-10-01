"""Post list and bulk upsert (extracted from data routes)."""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from dataclasses import replace
from typing import Any

from sqlalchemy import (
    ColumnElement,
    Integer,
    and_,
    cast,
    column,
    func,
    literal,
    not_,
    or_,
    update,
    values,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import aliased
from sqlmodel import Session, col, select

from app.models_tg import Post, utc_now
from app.schemas.post_media import MEDIA_COUNTER_KEYS
from app.services.channels import relabel_channels
from app.services.follows import visible_channel_names
from app.services.language import own_words, read_language
from app.services.post_filters import (
    MEDIA_KIND_ORDER,
    POST_TYPE_ORDER,
    VIEW_SORTS,
    CapMode,
    FeedSort,
    PostFilters,
    ViewReading,
    apply_analysis_window,
    apply_post_filters,
    media_kind_clause,
    post_type_clause,
    tree_clause,
)
from app.services.reach import MS_PER_HOUR, REFRESH_HORIZON_HOURS
from app.services.serialization import post_to_camel
from app.services.sync_meta import touch_sync
from app.services.tenancy import scoped_select, unscoped_select
from app.services.view_observations import Sighting, record_view_observations

DEFAULT_POST_PAGE_SIZE = 500
MAX_POST_PAGE_SIZE = 5000
MAX_POST_LOOKUP_BATCH = 200

#: A stored Post's counters are refreshed until it is this old (REACH-02,
#: ADR-024). Derived from the one the settling age is validated against, so the
#: validation and the refresh cannot disagree (REACH-10).
COUNTER_REFRESH_HORIZON_MS = REFRESH_HORIZON_HOURS * MS_PER_HOUR


def _post_media_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    media = item.get("media")
    if not isinstance(media, dict):
        return None
    return {k: v for k, v in media.items() if k not in MEDIA_COUNTER_KEYS}


def _int_or_none(value: object) -> int | None:
    # bool is an int subclass, and import delivers whatever JSON it was given.
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _reaction_chips(value: object) -> list[Any] | None:
    # `PostResponse` declares `count` on every chip, so one bad entry kept here
    # would 500 every read of a Post every Follower shares.
    if not isinstance(value, list):
        return None
    return [
        chip
        for chip in value
        if isinstance(chip, dict) and _int_or_none(chip.get("count")) is not None
    ]


def _counter_fields(item: dict[str, Any], now_ms: int) -> dict[str, Any]:
    """The three counter columns a payload item sets (REACH-01, ADR-024).

    An export carries them at the top level; the scraper carries them inside
    media, and this is the one place that lifts them out. A scraped Post was
    observed now, which for a new one is its retrieval time. An item with
    neither leaves the columns alone.
    """
    if any(k in item for k in ("viewsCount", "reactionCounts", "viewsObservedAt")):
        return {
            "views_count": _int_or_none(item.get("viewsCount")),
            "reaction_counts": _reaction_chips(item.get("reactionCounts")),
            "views_observed_at": _int_or_none(item.get("viewsObservedAt")) or now_ms,
        }
    media = item.get("media")
    if not isinstance(media, dict):
        return {}
    return {
        "views_count": _int_or_none(media.get("viewsCount")),
        "reaction_counts": _reaction_chips(media.get("reactionCounts")),
        "views_observed_at": now_ms,
    }


def refresh_post_counters(
    session: Session, channel_name: str, items: list[dict[str, Any]]
) -> None:
    """Re-observe the counters of stored Posts a scraped page met again (REACH-02).

    One `UPDATE` for the page, setting the View count, reaction chips and
    observation time and nothing else: not `retrieval_*`, not `updated_at`,
    not `language`, not `references_extracted`. The counters are unindexed and
    `tg_posts` has `fillfactor = 90`, so the write can be a HOT update.

    * Only Posts younger than `COUNTER_REFRESH_HORIZON_MS`; an id the page
      carries that is not stored simply matches nothing.
    * The observation time moves even when the count did not: Telegram's
      rounded display holds one value for hours, and a skipped stamp would
      make a Settled Post look young.
    * The counters are what the page shows, `NULL` included, exactly as a
      first capture stores them.
    * It moves no etag. A View count is not a feed change, and a sync that
      found nothing new must not make every browser refetch. Does not commit.
    * Each refreshed Post is a sighting, which REACH-05 keeps as a View
      observation when the Observation stride selects it.
    """
    if not items:
        return
    now_ms = int(time.time() * 1000)
    rows = []
    for item in items:
        counters = _counter_fields(item, now_ms)
        rows.append(
            (
                int(item["id"]),
                counters.get("views_count"),
                counters.get("reaction_counts"),
            )
        )
    seen = values(
        column("post_id", Integer),
        column("views_count", Integer),
        column("reaction_counts", JSONB(none_as_null=True)),
        name="seen",
    ).data(rows)
    refreshed = session.execute(
        update(Post)
        .where(
            col(Post.channel_name) == channel_name,
            col(Post.post_id) == seen.c.post_id,
            col(Post.timestamp) >= now_ms - COUNTER_REFRESH_HORIZON_MS,
        )
        # Cast, because a column that is NULL on every row of the page types
        # as text inside `VALUES`, and Postgres refuses text for either column.
        .values(
            views_count=cast(seen.c.views_count, Integer),
            reaction_counts=cast(seen.c.reaction_counts, JSONB(none_as_null=True)),
            views_observed_at=now_ms,
        )
        .returning(
            col(Post.id), col(Post.post_id), col(Post.views_count), col(Post.timestamp)
        )
        .execution_options(synchronize_session=False)
    )
    record_view_observations(
        session,
        (
            Sighting(uuid_, post_id, views, ts, now_ms)
            for uuid_, post_id, views, ts in refreshed
        ),
    )


def _post_links_from_item(item: dict[str, Any]) -> list[Any] | None:
    links = item.get("links")
    return links if isinstance(links, list) else None


def _is_link_span(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    offset, length = entry.get("offset"), entry.get("length")
    return (
        type(offset) is int
        and type(length) is int
        and isinstance(entry.get("url"), str)
    )


def _post_link_spans_from_item(item: dict[str, Any]) -> list[Any] | None:
    # Import and `/data/posts/bulk` take any JSON, and `PostResponse` declares
    # the entry shape, so one bad entry kept here would 500 every read of a
    # Post every Follower shares. `type(...) is int` because bool is an int.
    spans = item.get("linkSpans", item.get("link_spans"))
    if not isinstance(spans, list):
        return None
    return [
        {"offset": s["offset"], "length": s["length"], "url": s["url"]}
        for s in spans
        if _is_link_span(s)
    ]


def _post_reply_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    reply = item.get("replyTo", item.get("reply_to"))
    return reply if isinstance(reply, dict) else None


def _post_int_from_item(item: dict[str, Any], camel: str, snake: str) -> int | None:
    # `isinstance` rather than a truth test: the JSON import path can deliver a
    # string here, and bool is an int subclass.
    return _int_or_none(item.get(camel, item.get(snake)))


def _item_fields(item: dict[str, Any]) -> dict[str, Any]:
    """The Post columns a payload item sets, read under either spelling.

    The scraper and an export round trip send camelCase; import and
    `/data/posts/bulk` take any JSON, so the snake_case column names are read
    too. A key that is absent is absent from the answer, except for the three
    columns an update has always overwritten unconditionally, so the update
    branch can apply the answer as it stands and the insert branch lays it over
    its defaults.

    `replyTo` is the one field guarded on a single spelling: an update ignores a
    snake-only `reply_to`, where an insert reads either.
    """
    fields: dict[str, Any] = {
        "forwarded_from": item.get("forwardedFrom") or item.get("forwarded_from"),
        "forwarded_from_name": item.get("forwardedFromName")
        or item.get("forwarded_from_name"),
        "reply_to_post_id": _post_int_from_item(
            item, "replyToPostId", "reply_to_post_id"
        ),
    }
    # Guarded on the key where the fields above are not, and the difference is
    # which payloads carry the key. `post_to_camel` emits a fixed set of keys
    # and CRG-03's column is not among them, so this function — which
    # `POST /data/import` and `/data/posts/bulk` share with the scraper — would
    # take an absent key as "no id" and null the column on every Post an export
    # round trip restored. The href is gone, so nothing could put it back.
    # `forwarded_from` and `reply_to_post_id` are exported, so their
    # unconditional writes restore themselves; this one does not.
    if "forwardedFromPostId" in item or "forwarded_from_post_id" in item:
        fields["forwarded_from_post_id"] = _post_int_from_item(
            item, "forwardedFromPostId", "forwarded_from_post_id"
        )
    for key in ("text", "date", "timestamp"):
        if key in item:
            fields[key] = item[key]
    if "media" in item:
        fields["media"] = _post_media_from_item(item)
    if "links" in item:
        fields["links"] = _post_links_from_item(item)
    # Key-guarded like `forwardedFromPostId`, so an export from before LINK-01
    # leaves the column alone. The update branch drops the stored spans when
    # the words change and this key is absent (ADR-022).
    if "linkSpans" in item or "link_spans" in item:
        fields["link_spans"] = _post_link_spans_from_item(item)
    if "replyTo" in item:
        fields["reply_to"] = _post_reply_from_item(item)
    return fields


#: What a new Post holds in a column `_item_fields` leaves out. `reply_to` is
#: not here: an insert reads it under either spelling, unlike the update guard.
_INSERT_DEFAULTS: dict[str, Any] = {
    "text": "",
    "date": "",
    "timestamp": 0,
    "forwarded_from_post_id": None,
    "media": None,
    "links": None,
    "link_spans": None,
}


def _sighting(post: Post) -> Sighting:
    return Sighting(
        post.id,
        post.post_id,
        post.views_count,
        post.timestamp,
        post.views_observed_at or 0,
    )


def bulk_upsert_posts_impl(
    body: list[dict[str, Any]],
    session: Session,
    *,
    retrieval_job_id: str | None = None,
    retrieval_pass: str | None = None,
    retrieval_source: str | None = None,
    announce_relabels: bool = True,
    stored_counters: bool = True,
) -> int:
    """Insert or overwrite each Post the payload names, and label its Channels.

    `stored_counters=False` leaves an already-stored Post's View count,
    reaction chips and observation time alone. Sync passes it because it
    re-observes those through `refresh_post_counters`, under the refresh
    horizon (REACH-10); an import restores an export's counters whatever the
    Post's age, so it keeps the default.
    """
    count = 0
    now_ms = int(time.time() * 1000)
    touched: set[str] = set()
    sightings: list[Sighting] = []
    for item in body:
        channel = item.get("channelName") or item.get("channel_name", "")
        touched.add(channel)
        post_id = int(item.get("id") or item.get("post_id", 0))
        existing = session.exec(
            select(Post).where(Post.channel_name == channel, Post.post_id == post_id)
        ).first()
        counters = (
            _counter_fields(item, now_ms) if stored_counters or not existing else {}
        )
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
            was_text = existing.text
            fields = _item_fields(item) | counters
            for column, value in fields.items():
                setattr(existing, column, value)
            # Positions measured against other words link the wrong ones, and
            # null sends the renderer back to its regex (ADR-022).
            if "link_spans" not in fields and existing.text != was_text:
                existing.link_spans = None
            # Conditional, and that is the whole point: an import restores a
            # whole export and a first sync re-upserts its page, so clearing the
            # flag unconditionally would hand reference extraction every
            # unchanged row they touch. Sync's incremental and backfill passes
            # never get here, because `_persist_page_posts` drops a Post already
            # stored before the upsert.
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
            columns: dict[str, Any] = {
                **_INSERT_DEFAULTS,
                "reply_to": _post_reply_from_item(item),
                # Observed when retrieved, counters or none (REACH-01).
                "views_observed_at": now_ms,
                **_item_fields(item),
                **counters,
            }
            post = Post(
                channel_name=channel,
                post_id=post_id,
                **columns,
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
            existing = post
        # Any write of counters is a sighting (REACH-05): a first capture, a
        # first pass meeting its page again, an import restoring one.
        if counters:
            sightings.append(_sighting(existing))
        count += 1
    record_view_observations(session, sightings)
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


def channel_order(sort: FeedSort, entity: Any, reading: ViewReading) -> list[Any]:
    """The chosen order within one channel, ending in a unique tiebreak.

    Newest and oldest are the timestamp, then `post_id` running the same way,
    so a collision still reads in posting order. Most and fewest views are the
    value under `reading`, a Post with none last in both directions, then
    newest first (PFB-03). `(channel_name, post_id)` is unique, which is what
    makes offset paging deterministic. Also the ranking the `ordered` cap keeps
    the first N of, which is the whole of "the cap follows the order" (PFB-01).

    Public for the reason `random_cap_order` is: Discover applies the same cap,
    and a capped report reads the Posts the feed shows only while the two rank
    a channel identically.
    """
    if sort == "oldest":
        return [entity.timestamp.asc(), entity.post_id.asc()]
    newest = [entity.timestamp.desc(), entity.post_id.desc()]
    if sort == "most_views":
        return [reading.of(entity).desc().nulls_last(), *newest]
    if sort == "fewest_views":
        return [reading.of(entity).asc().nulls_last(), *newest]
    return newest


def _block_order(sort: FeedSort, entity: Any, reading: ViewReading) -> Any:
    """Each channel's best key under the order, as the grouped feed leads with it."""
    key = reading.of(entity) if sort in VIEW_SORTS else entity.timestamp
    if sort in ("oldest", "fewest_views"):
        return func.min(key).over(partition_by=entity.channel_name).asc().nulls_last()
    return func.max(key).over(partition_by=entity.channel_name).desc().nulls_last()


def feed_order_by(
    sort: FeedSort, group_by_channel: bool, entity: Any, reading: ViewReading
) -> list[Any]:
    """Deterministic ORDER BY for the feed, with a stable tiebreak for paging.

    Ungrouped is the chosen order across every channel, with the channel name
    breaking a tie before `post_id` does.

    Grouped leads with each channel's **best** key under the chosen order (its
    newest Post under `newest`, its most viewed under `most_views`), so a
    channel's block sits where its first Post falls, then the chosen order
    inside the block (PFB-02). The window runs over the rows the query already
    kept, so under a cap a block is placed by the Posts the cap kept. The
    channel name breaks a tie between two blocks, which keeps paging
    deterministic.
    """
    *keys, post_id = channel_order(sort, entity, reading)
    if group_by_channel:
        return [
            _block_order(sort, entity, reading),
            entity.channel_name.asc(),
            *keys,
            post_id,
        ]
    return [*keys, entity.channel_name.asc(), post_id]


def list_feed(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
    filters: PostFilters | None = None,
    max_per_channel: int = 0,
    max_per_channel_mode: CapMode = "ordered",
    sort: FeedSort = "newest",
    group_by_channel: bool = False,
    seed: int = 0,
    limit: int = DEFAULT_POST_PAGE_SIZE,
    offset: int = 0,
    selected: ColumnElement[bool] | None = None,
    only_selected: bool = False,
) -> list[dict[str, Any]]:
    """One page of the Posts feed, filtered / capped / sorted entirely in SQL.

    Replaces the frontend's eager ``filteredPosts`` for the Posts tab: rather
    than paging a channel's whole history into the browser and filtering there,
    the keyword, the Post filter, the per-channel cap, and the sort all run
    server-side and only ``limit`` rows are returned. With no filters,
    no cap, and ``sort="newest"`` this is a newest-first page.

    The read stays bounded: ``tg_posts`` holds millions of rows across hundreds
    of channels, and an unbounded select here materialised gigabytes into a
    worker — the root cause of the staging incident. The ``ORDER BY`` always
    ends in ``(channel_name, post_id)`` so offset paging is deterministic (a
    non-deterministic order silently repeats and skips rows across pages).

    ``user_id`` narrows the read to Channels the caller Follows (ticket 16).
    The predicate goes on ``base``, *before* the ``row_number()`` wrapper
    below, so a capped feed ranks only rows the caller can see — applying it
    outside the subquery would let another account's posts consume the cap.

    `selected` is the Post selection's predicate (`post_selection`): with it,
    each row says whether it is selected, and `only_selected` keeps only
    those, which is what an Action reads (PTR-05).
    """
    base = _in_scope(
        session,
        select(Post),
        user_id=user_id,
        channel_names=channel_names,
        start_date=start_date,
        end_date=end_date,
        filters=filters,
    )
    reading = (filters or PostFilters()).reading
    if selected is not None:
        base = base.add_columns(selected.label("selected"))
        if only_selected:
            base = base.where(selected)

    if max_per_channel > 0:
        # `ordered` ranks by the chosen order, so the N kept are the first N
        # the feed would show; under `newest` that is the newest N, exactly
        # what `latest` kept.
        cap_order = (
            [random_cap_order(seed)]
            if max_per_channel_mode == "random"
            else channel_order(sort, Post, reading)
        )
        row_number = (
            func.row_number()
            .over(partition_by=col(Post.channel_name), order_by=cap_order)
            .label("rn")
        )
        ranked = base.add_columns(row_number).subquery()
        capped = aliased(Post, ranked)
        stmt = (
            select(capped, *([ranked.c.selected] if selected is not None else []))
            .where(ranked.c.rn <= max_per_channel)
            .order_by(*feed_order_by(sort, group_by_channel, capped, reading))
            .offset(offset)
            .limit(limit)
        )
    else:
        stmt = (
            base.order_by(*feed_order_by(sort, group_by_channel, Post, reading))
            .offset(offset)
            .limit(limit)
        )
    return _rows(session, stmt, selected is not None)


def _rows(session: Session, stmt: Any, flagged: bool) -> list[dict[str, Any]]:
    """Posts as the wire has them, each with its `selected` flag when asked.

    `execute` for the flagged rows: SQLModel's `exec` reads a `select(Post)`
    that gained a column as scalars, which drops the flag.
    """
    if not flagged:
        return [post_to_camel(p) for p in session.exec(stmt).all()]
    return [
        {**post_to_camel(p), "selected": bool(chosen)}
        for p, chosen in session.execute(stmt).all()
    ]


def lookup_posts(
    session: Session,
    pairs: list[tuple[str, int]],
    *,
    user_id: uuid.UUID,
    filters: PostFilters | None = None,
    selected: ColumnElement[bool] | None = None,
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

    `filters` narrows the batch to the Posts the Post filter shows, which is
    how a meaning search's ranked Posts pass it (PTR-03). A Post it hides is
    absent like any other. `selected` flags each row, as on the feed (PTR-05).
    """
    unique = {(name, post_id) for name, post_id in pairs}
    if not unique:
        return []
    columns = select(Post) if selected is None else select(Post, selected)
    stmt = _filtered(session, scoped_select(columns, Post, user_id), user_id, filters)
    stmt = stmt.where(
        or_(
            *[
                (col(Post.channel_name) == name) & (col(Post.post_id) == post_id)
                for name, post_id in unique
            ]
        )
    )
    return _rows(session, stmt, selected is not None)


def count_selected(
    session: Session,
    selected: ColumnElement[bool],
    *,
    user_id: uuid.UUID,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
) -> dict[str, int]:
    """Per-channel counts of the selected Posts in the window, filters aside.

    What an Action covers (PTR-05): the selection bar's count, the Channels
    tab's "Posts in scope", and the AI paths' size check. A channel with none
    is absent, as in `count_scope`.
    """
    rows = session.exec(
        _in_scope(
            session,
            select(col(Post.channel_name), func.count()),
            user_id=user_id,
            channel_names=channel_names,
            start_date=start_date,
            end_date=end_date,
            filters=None,
        )
        .where(selected)
        .group_by(col(Post.channel_name))
    ).all()
    return dict(rows)


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
    fetched, client-filtered post array. Applies whatever `filters` names: the
    keyword alone on the prompt path, the Post filter too for the feed's.

    `max_per_channel` clamps each channel's count to the cap. The cap's
    `random` and `ordered` modes select *different* posts but the same *number*
    per channel, so a count is mode- and order-independent and needs no client
    fallback.

    Scoped with the same `user_id` `list_feed` takes, and it has to be: the AI
    paths sum these counts to decide whether a selection fits in one prompt and
    then call `list_feed` to assemble it, so a count over a wider set than the
    feed returns would refuse a selection that would actually have fit.
    """
    counts, _too_new = count_scope(
        session,
        user_id=user_id,
        channel_names=channel_names,
        start_date=start_date,
        end_date=end_date,
        filters=filters,
        max_per_channel=max_per_channel,
    )
    return counts


def count_scope(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
    filters: PostFilters | None = None,
    max_per_channel: int = 0,
) -> tuple[dict[str, int], int]:
    """`count_posts_in_scope`, and how many Posts were too new to judge (PFB-03).

    The second number is the Posts the filter hid that an Estimated views bound
    could not judge for being under the estimation floor, so an empty Live
    window can say why. It is one more filtered aggregate in the same scan:
    with such a bound the tree moves from the `WHERE` into the per-channel
    count's `FILTER`, so the rows it hides are still there to be counted. A
    too-new Post the tree keeps anyway, through the other half of an OR, was
    not hidden and is not counted (PTR-03). Not clamped to the cap, which
    applies only to the Posts the tree kept. A channel whose count is zero is
    absent, as it was before.
    """
    filters = filters or PostFilters()
    kept: Any = func.count()
    too_new: Any = literal(0)
    estimate = filters.tree_readings.get("estimated")
    if filters.tree is not None and filters.has_tree() and estimate is not None:
        shown = _tree_clause(session, filters, user_id)
        kept = func.count().filter(shown)
        too_new = func.count().filter(and_(not_(shown), estimate.too_new(Post)))
        filters = replace(filters, tree=None)
    if max_per_channel > 0:
        kept = func.least(kept, max_per_channel)

    rows = session.exec(
        _in_scope(
            session,
            select(col(Post.channel_name), kept, too_new),
            user_id=user_id,
            channel_names=channel_names,
            start_date=start_date,
            end_date=end_date,
            filters=filters,
        ).group_by(col(Post.channel_name))
    ).all()
    return (
        {channel: n for channel, n, _hidden in rows if n > 0},
        sum(hidden for _channel, _n, hidden in rows),
    )


def count_facets_in_scope(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_names: list[str] | None = None,
    start_date: int | None = None,
    end_date: int | None = None,
) -> dict[str, Any]:
    """How many Posts in the window have each Type, media kind and Language.

    The counts the Type, Media and Language dropdowns print beside each value
    (PTR-03): how many Posts in the window have it, **filters aside**, because
    a dropdown row is a value to funnel on, and later a value to select by
    whatever the filter shows (PTR-06). No keyword, no tree, no cap.

    Languages are the ones present, most frequent first, an unread Post left
    out because it has no Language to funnel. The Types are all three and the
    media kinds all six, in the dropdowns' order, zero included; both overlap,
    so they are filtered aggregates over one scan rather than a `GROUP BY`.
    `total` is every Post in the window, in the same scan.
    """

    def scoped(stmt: Any) -> Any:
        return _in_scope(
            session,
            stmt.select_from(Post),
            user_id=user_id,
            channel_names=channel_names,
            start_date=start_date,
            end_date=end_date,
            filters=None,
        )

    followed = frozenset(visible_channel_names(session, user_id=user_id))
    language_rows = session.exec(
        scoped(select(col(Post.language), func.count()))
        .where(col(Post.language).is_not(None))
        .group_by(col(Post.language))
    ).all()
    counts = session.exec(
        scoped(
            select(
                func.count(),
                *(
                    func.count().filter(post_type_clause(value, followed))
                    for value in POST_TYPE_ORDER
                ),
                *(
                    func.count().filter(media_kind_clause(kind))
                    for kind in MEDIA_KIND_ORDER
                ),
            )
        )
    ).one()
    total, *rest = counts
    types, kinds = rest[: len(POST_TYPE_ORDER)], rest[len(POST_TYPE_ORDER) :]

    return {
        "total": total,
        "types": list(zip(POST_TYPE_ORDER, types, strict=True)),
        "languages": sorted(
            ((language, n) for language, n in language_rows),
            key=lambda kv: (-kv[1], kv[0]),
        ),
        "media": list(zip(MEDIA_KIND_ORDER, kinds, strict=True)),
    }


def _followed_for(
    session: Session, filters: PostFilters, user_id: uuid.UUID
) -> frozenset[str] | None:
    """The followed-channel set, read only when an `unfollowed_forwarded` needs it."""
    if not filters.reads_unfollowed():
        return None
    return frozenset(visible_channel_names(session, user_id=user_id))


def _tree_clause(session: Session, filters: PostFilters, user_id: uuid.UUID) -> Any:
    assert filters.tree is not None
    return tree_clause(
        filters.tree,
        readings=filters.tree_readings,
        followed_names=_followed_for(session, filters, user_id),
    )


def _filtered(
    session: Session, stmt: Any, user_id: uuid.UUID, filters: PostFilters | None
) -> Any:
    if filters is None:
        return stmt
    return apply_post_filters(
        stmt, filters, followed_names=_followed_for(session, filters, user_id)
    )


def _in_scope(
    session: Session,
    stmt: Any,
    *,
    user_id: uuid.UUID,
    channel_names: list[str] | None,
    start_date: int | None,
    end_date: int | None,
    filters: PostFilters | None,
) -> Any:
    """`stmt` narrowed to the caller's Follows, the channels, window and filters.

    The one spelling of "the Posts this Scope covers" the feed, the counts and
    the facets share, so none of them can count a Post another does not show.
    """
    stmt = scoped_select(stmt, Post, user_id)
    if channel_names:
        stmt = stmt.where(col(Post.channel_name).in_(channel_names))
    stmt = apply_analysis_window(stmt, start_date, end_date)
    return _filtered(session, stmt, user_id, filters)


def bulk_upsert_posts(session: Session, body: list[dict[str, Any]]) -> dict[str, int]:
    count = bulk_upsert_posts_impl(body, session)
    session.commit()
    touch_sync(session, "posts")
    return {"upserted": count}
