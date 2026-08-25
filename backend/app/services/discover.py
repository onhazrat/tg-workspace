"""Server-side Discover candidate aggregation.

Ports `frontend/src/lib/posts/discover-candidates.ts`. The frontend used to
fetch every post body for the selected channels and date range, then extract
forwards, mentions and links and aggregate them in JS — to produce a handful
of counts. The aggregation now happens next to the data.

Counting rules preserved verbatim from the frontend implementation:
  - per post, a handle contributes at most one occurrence of each kind;
  - self-references (a channel naming itself) are excluded;
  - handle comparison is case-insensitive;
  - invite / private / reserved `t.me` paths are not handles.

Handle validation and URL parsing reuse the existing backend helpers so the
two implementations cannot drift.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.models_tg import Post
from app.services.discover_ignored import ignored_handles
from app.services.follows import visible_channel_names
from app.services.post_filters import PostFilters, apply_post_filters
from app.services.post_links_parser import channel_from_telegram_url
from app.services.posts import random_cap_order
from app.services.telegram_web import _all_web_domains, is_channel_handle
from app.services.tenancy import scoped_select

SignalKind = Literal["forward", "mention", "link"]
SIGNAL_KINDS: tuple[SignalKind, ...] = ("forward", "mention", "link")

# Mirrors `extractMentions` in frontend/src/lib/posts/telegram-handles.ts.
# The leading group is the email/path false-positive guard: the `@` must not
# follow a word character, another `@`, or a slash, so `user@example.com` and
# `foo/@bar` are not mentions.
_MENTION_RE = re.compile(r"(^|[^\w@/])@([A-Za-z][A-Za-z0-9_]{4,31})(?!\w)")


def _text_link_re() -> re.Pattern[str]:
    domains = "|".join(re.escape(d) for d in _all_web_domains())
    return re.compile(
        rf"(?:https?://)?(?:www\.)?(?:{domains})/([^\s<>\"')\]]+)",
        re.IGNORECASE,
    )


def normalize_handle(name: str) -> str:
    return name.lstrip("@").strip().lower()


def extract_mentions(text: str) -> set[str]:
    if not text:
        return set()
    return {
        normalize_handle(m.group(2))
        for m in _MENTION_RE.finditer(text)
        if is_channel_handle(m.group(2))
    }


def extract_text_links(text: str) -> set[str]:
    if not text:
        return set()
    found: set[str] = set()
    for match in _text_link_re().finditer(text):
        handle = channel_from_telegram_url(f"https://t.me/{match.group(1)}")
        if handle:
            found.add(normalize_handle(handle))
    return found


def extract_post_link_channels(post: Post) -> set[str]:
    """Masked hrefs captured at scrape time, unioned with plain-text URLs.

    Deduped: once the links backfill has run a plain `https://t.me/foo`
    appears in both sources and must still count once.
    """
    found = extract_text_links(post.text)
    for link in post.links or []:
        if not isinstance(link, dict):
            continue
        channel = link.get("channel")
        if isinstance(channel, str) and is_channel_handle(channel):
            found.add(normalize_handle(channel))
            continue
        url = link.get("url")
        if isinstance(url, str):
            found |= extract_text_links(url)
    return found


def post_references(post: Post) -> dict[str, set[SignalKind]]:
    """Handles a post references, per kind, with self-references removed."""
    self_handle = normalize_handle(post.channel_name)
    refs: dict[str, set[SignalKind]] = {}

    def add(handle: str, kind: SignalKind) -> None:
        if not handle or handle == self_handle:
            return
        refs.setdefault(handle, set()).add(kind)

    if post.forwarded_from:
        add(normalize_handle(post.forwarded_from), "forward")
    for handle in extract_mentions(post.text):
        add(handle, "mention")
    for handle in extract_post_link_channels(post):
        add(handle, "link")
    # A reply to a post in another channel is a t.me link like any other, so it
    # counts as a "link" signal rather than needing a new SignalKind. Replies
    # within the same channel — the common case — drop out via `add`'s
    # self-reference guard.
    reply_channel = (post.reply_to or {}).get("channel")
    if isinstance(reply_channel, str) and is_channel_handle(reply_channel):
        add(normalize_handle(reply_channel), "link")

    return refs


def _empty_counts() -> dict[str, int]:
    return {"forward": 0, "mention": 0, "link": 0}


@dataclass
class _Accumulator:
    canonical_name: str
    display_name: str | None = None
    counts: dict[str, int] = field(default_factory=_empty_counts)
    by_carrier: dict[str, dict[str, int]] = field(default_factory=dict)
    last_seen: int = 0
    sample_post: Post | None = None


def compute_discover_candidates(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_names: list[str],
    start_date: int | None = None,
    end_date: int | None = None,
    signals: set[SignalKind] | None = None,
    filters: PostFilters | None = None,
    max_per_channel: int = 0,
    max_per_channel_mode: str = "latest",
    seed: int = 0,
    post_ids: list[tuple[str, int]] | None = None,
) -> dict[str, Any]:
    """Aggregate discovery candidates for a channel/date scope.

    Returns the same shape the frontend computed: candidates sorted by total
    descending, plus post-level `scopeCounts` which always report every kind
    regardless of which signals are enabled.

    `filters` and the cap reproduce the Posts-tab view the frontend aggregated
    over (`buildFilteredPostsFromRaw`): keyword / forwarded / media, then the
    per-channel cap in either `latest` or `random` mode — `random` reuses the
    feed's seeded ordering (`posts.random_cap_order`) so the same posts are
    chosen for the same seed.

    `post_ids` restricts the scope to an explicit `(channel_name, post_id)` set.
    That is how a semantic (vector) query is expressed here: the caller runs the
    vector search, which owns the ranking, and passes the resulting posts in.
    Aggregation therefore has exactly one implementation regardless of how the
    post set was chosen (IDEA-011 D14).

    `user_id` scopes the aggregation to Channels the caller Follows (ticket
    16). It narrows *two* independent reads, not one: the Posts being scanned,
    and the followed-channel set behind each candidate's `isFollowed` flag. The
    second is the one worth naming — left unscoped it reports a candidate as
    already followed because another account follows it, which is both the
    wrong answer for this caller and a fact about somebody else's account.

    It also makes `post_ids` safe to accept from an unscoped ranker: the
    semantic path runs its own vector search and passes the winners in here, so
    the scoping predicate on the Post select is what keeps a post the caller
    may not see out of the aggregate regardless of how it was chosen.
    """
    enabled = signals if signals is not None else set(SIGNAL_KINDS)

    scope_counts = {"forwardPosts": 0, "mentionPosts": 0, "linkPosts": 0}
    # An explicit empty `post_ids` means "the search matched nothing", which is
    # an empty scope — not "no restriction".
    if not channel_names or not enabled or post_ids == []:
        return {"candidates": [], "scopeCounts": scope_counts, "postsInScope": 0}

    followed = visible_channel_names(session, user_id=user_id)

    stmt = scoped_select(select(Post), Post, user_id).where(
        col(Post.channel_name).in_(channel_names)
    )
    if start_date is not None:
        stmt = stmt.where(Post.timestamp >= start_date)
    if end_date is not None:
        stmt = stmt.where(Post.timestamp <= end_date)
    if post_ids:
        unique_pairs = {(name, post_id) for name, post_id in post_ids}
        stmt = stmt.where(
            or_(
                *[
                    (col(Post.channel_name) == name) & (col(Post.post_id) == post_id)
                    for name, post_id in unique_pairs
                ]
            )
        )
    if filters is not None:
        stmt = apply_post_filters(stmt, filters, followed_names=frozenset(followed))
    # Order by channel first so the per-channel cap can be applied while
    # streaming. `latest` then orders by timestamp desc, which is served by
    # ix_tg_posts_channel_name_timestamp; `random` uses the feed's seeded
    # ordering so the cap selects the same posts the Posts tab would show.
    if max_per_channel > 0 and max_per_channel_mode == "random":
        stmt = stmt.order_by(col(Post.channel_name), random_cap_order(seed))
    else:
        stmt = stmt.order_by(col(Post.channel_name), col(Post.timestamp).desc())

    by_source: dict[str, _Accumulator] = {}
    seen_per_channel: dict[str, int] = {}
    posts_in_scope = 0

    # Stream in batches: the whole point is to avoid materialising every post
    # body at once, which is what this endpoint replaces on the client side.
    for post in session.exec(stmt.execution_options(yield_per=1000)):
        if max_per_channel > 0:
            seen = seen_per_channel.get(post.channel_name, 0)
            if seen >= max_per_channel:
                continue
            seen_per_channel[post.channel_name] = seen + 1

        # Every post that survives the filters and cap — the client's
        # `filteredPosts.length`, used to tell "empty scope" from "posts exist
        # but reference nothing".
        posts_in_scope += 1

        all_refs = post_references(post)
        if not all_refs:
            continue

        kinds_present = set().union(*all_refs.values())
        if "forward" in kinds_present:
            scope_counts["forwardPosts"] += 1
        if "mention" in kinds_present:
            scope_counts["mentionPosts"] += 1
        if "link" in kinds_present:
            scope_counts["linkPosts"] += 1

        for handle, all_kinds in all_refs.items():
            kinds = all_kinds & enabled
            if not kinds:
                continue

            entry = by_source.get(handle)
            if entry is None:
                entry = _Accumulator(
                    # Preserve first-seen casing for display; the key stays
                    # the normalized handle.
                    canonical_name=(
                        (post.forwarded_from or handle).lstrip("@").strip()
                        if "forward" in kinds
                        else handle
                    ),
                    last_seen=post.timestamp,
                    sample_post=post,
                )
                by_source[handle] = entry

            carrier = entry.by_carrier.setdefault(post.channel_name, _empty_counts())
            for kind in kinds:
                entry.counts[kind] += 1
                carrier[kind] += 1

            is_newest = post.timestamp >= entry.last_seen
            if is_newest:
                entry.last_seen = post.timestamp
                entry.sample_post = post
            # Forward metadata is the only source of a human-readable name.
            if "forward" in kinds and post.forwarded_from_name:
                if is_newest or not entry.display_name:
                    entry.display_name = post.forwarded_from_name
                    entry.canonical_name = (
                        (post.forwarded_from or handle).lstrip("@").strip()
                    )

    ignored = ignored_handles(session)
    candidates = [
        _to_candidate(handle, entry, followed, ignored)
        for handle, entry in by_source.items()
        if entry.sample_post is not None
    ]
    candidates.sort(
        key=lambda c: (
            -c["total"],
            -c["seenInCount"],
            -c["lastSeen"],
            c["name"],
        )
    )

    return {
        "candidates": candidates,
        "scopeCounts": scope_counts,
        "postsInScope": posts_in_scope,
    }


def _to_candidate(
    handle: str, entry: _Accumulator, followed: set[str], ignored: set[str]
) -> dict[str, Any]:
    seen_in: list[dict[str, Any]] = [
        {
            "channelName": channel_name,
            "counts": counts,
            "total": sum(counts.values()),
        }
        for channel_name, counts in entry.by_carrier.items()
    ]
    seen_in.sort(key=lambda s: (-sum(s["counts"].values()), s["channelName"]))
    sample = entry.sample_post
    assert sample is not None  # guarded by the caller

    return {
        "name": entry.canonical_name,
        "displayName": entry.display_name,
        "counts": entry.counts,
        "total": sum(entry.counts.values()),
        "seenIn": seen_in,
        "seenInCount": len(seen_in),
        "lastSeen": entry.last_seen,
        "isFollowed": handle in followed,
        "isIgnored": handle in ignored,
        "samplePost": {
            "channelName": sample.channel_name,
            "postId": sample.post_id,
            "timestamp": sample.timestamp,
        },
    }
