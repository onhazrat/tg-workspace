"""Server-side Discover candidate aggregation.

Ports `frontend/src/lib/posts/discover-candidates.ts`. The frontend used to
fetch every post body for the selected channels and date range, then extract
forwards, mentions and links and aggregate them in JS — to produce a handful
of counts. The aggregation now happens next to the data.

Counting rules preserved verbatim from the frontend implementation:
  - per post, a handle contributes at most one occurrence of each kind;
  - self-references (a channel naming itself) are excluded;
  - a link that is only the anchor around an @mention counts as the mention
    and not as a link (`is_the_mention`);
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

from sqlalchemy import ColumnElement
from sqlmodel import Session, col, select

from app.models_tg import Post
from app.services.dismissals import dismissed_handles
from app.services.follows import visible_channel_names
from app.services.post_filters import ViewReading, apply_analysis_window
from app.services.posts import channel_order
from app.services.telegram_web import (
    _all_web_domains,
    extract_channel_post_from_href,
    is_channel_handle,
    normalize_handle,
)
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


def extract_mentions(text: str) -> set[str]:
    if not text:
        return set()
    return {
        normalize_handle(m.group(2))
        for m in _MENTION_RE.finditer(text)
        if is_channel_handle(m.group(2))
    }


def link_targets(
    text: str | None, links: list[Any] | None
) -> list[tuple[str, int | None]]:
    """Telegram links in a body as (handle, Post id), from its plain text and
    its stored hrefs (`links`), deduplicated.

    The stored hrefs are the masked anchors captured at scrape time; once the
    links backfill has run a plain `https://t.me/foo` appears in both sources
    and must still count once. The stored `url` is preferred over the stored
    `channel`: they are built from the same href, so they never name different
    Channels, but only the url carries the Post id. `post_references` below and
    the graph's extractor both read links through here.
    """
    found: dict[tuple[str, int | None], None] = {}

    def add(parsed: tuple[str, int | None] | None) -> None:
        if parsed is not None:
            found.setdefault((normalize_handle(parsed[0]), parsed[1]), None)

    for match in _text_link_re().finditer(text or ""):
        add(extract_channel_post_from_href(f"https://t.me/{match.group(1)}"))
    for link in links or []:
        if not isinstance(link, dict):
            continue
        url = link.get("url")
        if isinstance(url, str) and (parsed := extract_channel_post_from_href(url)):
            add(parsed)
            continue
        channel = link.get("channel")
        if isinstance(channel, str) and is_channel_handle(channel):
            add((channel, None))
    return list(found)


def is_the_mention(handle: str, post_id: int | None, mentions: set[str]) -> bool:
    """Whether a link is only the anchor Telegram wraps around an @mention.

    Telegram renders every plain `@foo` as `<a href="https://t.me/foo">`, so
    the links blob holds a second copy of each mention. A link naming no Post
    to a Channel the same Post @mentions names it the same way the mention
    does, so it is the mention and makes no `link` of its own: a masked "read
    here" or a bare `t.me/foo` beside `@foo` collapses too, which is the same
    Post naming the same Channel. A link to one exact Post names something the
    mention does not, and stays. See the **Reference** entry in `CONTEXT.md`.
    """
    return post_id is None and handle in mentions


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
    mentions = extract_mentions(post.text)
    for handle in mentions:
        add(handle, "mention")
    for handle, post_id in link_targets(post.text, post.links):
        if not is_the_mention(handle, post_id, mentions):
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
    #: The Reference: the newest Post seen so far that named this handle.
    reference: Post | None = None


def compute_discover_candidates(
    session: Session,
    *,
    user_id: uuid.UUID,
    channel_names: list[str],
    start_date: int | None = None,
    end_date: int | None = None,
    signals: set[SignalKind] | None = None,
    selected: ColumnElement[bool] | None = None,
) -> dict[str, Any]:
    """Aggregate discovery candidates for a channel/date scope.

    Returns the same shape the frontend computed: candidates sorted by total
    descending, plus post-level `scopeCounts` which always report every kind
    regardless of which signals are enabled.

    `selected` is the Post selection's predicate (`post_selection`): the
    report covers the Posts it selects, as every Action does (PTR-05). `None`
    is every Post in the window. A meaning search's ranked Posts reach here as
    Picks, so aggregation has one implementation however the Posts were chosen.

    `user_id` scopes the aggregation to Channels the caller Follows (ticket
    16). It narrows *two* independent reads, not one: the Posts being scanned,
    and the followed-channel set behind each candidate's `isFollowed` flag. The
    second is the one worth naming — left unscoped it reports a candidate as
    already followed because another account follows it, which is both the
    wrong answer for this caller and a fact about somebody else's account.

    It also makes a Pick safe to accept from an unscoped ranker: the scoping
    predicate on the Post select is what keeps a post the caller may not see
    out of the aggregate regardless of how it was chosen.
    """
    enabled = signals if signals is not None else set(SIGNAL_KINDS)

    scope_counts = {"forwardPosts": 0, "mentionPosts": 0, "linkPosts": 0}
    if not channel_names or not enabled:
        return {"candidates": [], "scopeCounts": scope_counts, "postsInScope": 0}

    followed = visible_channel_names(session, user_id=user_id)

    stmt = scoped_select(select(Post), Post, user_id).where(
        col(Post.channel_name).in_(channel_names)
    )
    stmt = apply_analysis_window(stmt, start_date, end_date)
    if selected is not None:
        stmt = stmt.where(selected)
    # Channel by channel, newest first, served by
    # ix_tg_posts_channel_name_timestamp.
    stmt = stmt.order_by(
        col(Post.channel_name), *channel_order("newest", Post, ViewReading())
    )

    by_source: dict[str, _Accumulator] = {}
    posts_in_scope = 0

    # Stream in batches: the whole point is to avoid materialising every post
    # body at once, which is what this endpoint replaces on the client side.
    for post in session.exec(stmt.execution_options(yield_per=1000)):
        # Every selected post, used to tell "empty scope" from "posts exist but
        # reference nothing".
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
                    reference=post,
                )
                by_source[handle] = entry

            carrier = entry.by_carrier.setdefault(post.channel_name, _empty_counts())
            for kind in kinds:
                entry.counts[kind] += 1
                carrier[kind] += 1

            is_newest = post.timestamp >= entry.last_seen
            if is_newest:
                entry.last_seen = post.timestamp
                entry.reference = post
            # Forward metadata is the only source of a human-readable name.
            if "forward" in kinds and post.forwarded_from_name:
                if is_newest or not entry.display_name:
                    entry.display_name = post.forwarded_from_name
                    entry.canonical_name = (
                        (post.forwarded_from or handle).lstrip("@").strip()
                    )

    dismissed = dismissed_handles(session, user_id=user_id)
    candidates = [
        _to_candidate(handle, entry, followed, dismissed)
        for handle, entry in by_source.items()
        if entry.reference is not None
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
    handle: str, entry: _Accumulator, followed: set[str], dismissed: set[str]
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
    reference = entry.reference
    assert reference is not None  # guarded by the caller

    return {
        "name": entry.canonical_name,
        "displayName": entry.display_name,
        "counts": entry.counts,
        "total": sum(entry.counts.values()),
        "seenIn": seen_in,
        "seenInCount": len(seen_in),
        "lastSeen": entry.last_seen,
        "isFollowed": handle in followed,
        "isIgnored": handle in dismissed,
        "reference": {
            "channelName": reference.channel_name,
            "postId": reference.post_id,
            "timestamp": reference.timestamp,
        },
    }
