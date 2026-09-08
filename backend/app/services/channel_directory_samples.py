"""A Directory entry's sample Posts (ticket 02, IDEA-011 D16).

The aggregate that owns `tg_channel_directory_samples` and is its only writer.
`channel_directory.py` owns the entry; this owns the snapshot hanging off it.
Two modules rather than one because an aggregate owns one table, and because
the two halves have different lifetimes: metadata is kept indefinitely, samples
expire on their own window.

## Replace, never merge

`replace_samples` deletes everything under the handle and writes what it was
given. The preview page is a sliding window, so a Post that dropped off it is
not a Post that still exists in the sample — reporting it as recent is exactly
the lie the Directory exists to avoid. A merge would keep every Post the handle
ever showed, forever, which is both wrong and unbounded.

**An empty list is a real answer and clears the snapshot.** A handle whose page
carries no readable messages has no recent Posts, and that is what an
`unavailable` verdict looks like from here.

**A payload with no samples key is not an empty list**, and that distinction
lives in the caller, not here. A fetch that never parsed Posts says nothing
about them, so `record_probe_result` does not call this function at all in that
case. It becomes load-bearing once sync — which fetches metadata and never
parses samples — starts feeding the Directory.

## It does not commit

The caller owns the transaction. `record_probe_result` writes the entry's
verdict and its samples as one unit: half a probe stored is a row claiming
`ok` beside somebody else's snapshot, and the two must land or fail together.
`session.flush()` is enough to make the delete precede the inserts.

## Nothing is deleted because an account acted

Following a Channel does not touch its samples. They simply stop being
maintained — the real Posts are in `tg_posts` by then — and age out on the
sample retention window like any other snapshot.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from sqlmodel import Session, col, delete, select

from app.models_tg import DirectorySample, utc_now

#: Why the reads and writes here do not go through `scoped_select`.
#:
#: The same argument `channel_directory.PROBE_SCOPE_REASON` makes, one level
#: down: a sample is a copy of a public preview page, so "what does @foo
#: publish" has one answer for every caller. `DirectorySample` is classified
#: `Scope.CORPUS` in `services/tenancy.py` for that reason, and the rows carry
#: no owner to scope by even if somebody wanted to.
SAMPLE_SCOPE_REASON = (
    "A sample is a copy of a public preview page, not an account's reading: "
    "'what does @foo publish' has the same answer for every caller, so "
    "`DirectorySample` is classified `Scope.CORPUS` in `services/tenancy.py` "
    "beside the `DirectoryEntry` it hangs off. The rows are written by a "
    "scheduled probe with no user behind it and carry no owner column at all."
)


def _row(
    handle: str, post: dict[str, Any], *, captured_at: datetime
) -> DirectorySample:
    return DirectorySample(
        handle=handle,
        post_id=int(post["id"]),
        text=str(post.get("text") or ""),
        date=str(post.get("date") or ""),
        timestamp=int(post.get("timestamp") or 0),
        forwarded_from=post.get("forwardedFrom") or None,
        forwarded_from_name=post.get("forwardedFromName") or None,
        media=post.get("media") or None,
        links=post.get("links") or None,
        reply_to_post_id=post.get("replyToPostId"),
        reply_to=post.get("replyTo") or None,
        captured_at=captured_at,
    )


def replace_samples(
    session: Session,
    handle: str,
    posts: list[dict[str, Any]],
    *,
    captured_at: datetime | None = None,
) -> int:
    """Make `posts` the handle's whole sample, and return how many were stored.

    `posts` are parsed Posts as `scraper._parse_posts_from_html` builds them —
    camelCase keys, media block included. A Post with no usable id is skipped
    rather than raising: the snapshot is best-effort decoration and one
    malformed widget must not fail a probe that otherwise succeeded.

    **Does not commit.** See the module docstring.
    """
    session.execute(
        delete(DirectorySample).where(col(DirectorySample.handle) == handle)
    )

    moment = captured_at or utc_now()
    seen: set[int] = set()
    stored = 0
    for post in posts:
        raw_id = post.get("id")
        if not isinstance(raw_id, int) or raw_id in seen:
            continue
        seen.add(raw_id)
        session.add(_row(handle, post, captured_at=moment))
        stored += 1
    session.flush()
    return stored


def expire_samples_before(session: Session, cutoff: datetime) -> int:
    """Drop every sample captured before `cutoff`, and return how many.

    The retention job's entry point. Measured on `captured_at` rather than the
    Post's own date, so a Channel that went quiet years ago keeps the snapshot
    taken of it last week — the entry would otherwise lose its samples the
    moment it was worth reading.

    Directory *metadata* is never collected by age. The map is cumulative on
    purpose; only the expensive half expires.

    **Does not commit**, like everything else here.
    """
    result = session.execute(
        delete(DirectorySample).where(col(DirectorySample.captured_at) < cutoff)
    )
    return int(cast(Any, result).rowcount or 0)


def samples_for(session: Session, handle: str) -> list[DirectorySample]:
    """Every sample stored for one handle, newest Post first.

    `record_probe_result` reads it back through here immediately after writing,
    to compute the entry's statistics (ticket 02). That is a query rather than
    reusing the parsed payload on purpose: `directory_statistics` takes **Posts**
    so the Channels tab can point it at the corpus later, and the rows this
    just flushed are the Posts. A probe is a handful per minute, so the extra
    indexed read is not a cost worth designing around.

    It began with no production caller at all, existing so the write path had an
    observable answer to assert against rather than tests reaching into the
    table and pinning its columns. It still serves that.
    """
    statement = (
        select(DirectorySample)
        .where(col(DirectorySample.handle) == handle)
        .order_by(col(DirectorySample.post_id).desc())
    )
    return list(session.exec(statement).all())
