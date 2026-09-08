"""What a Channel's sample Posts say about it (ticket 02, ADR-015).

A **pure transform**: no `Session`, no network, no clock. Two halves that are
deliberately not the same kind of thing.

`compute_sample_statistics` takes a list of Posts and returns the six values
stored on a Directory entry at probe time. It takes Posts rather than a
Directory entry so the Channels tab can later point it at the corpus — where
`Post` carries the same four attributes `DirectorySample` does — without a
second implementation of these formulas.

`media_mix` and `media_density` take the entry's own four counters and its
latest Post id, and are computed **at read**. Storing them would duplicate state
that can disagree with its own inputs, and buys nothing: the counters are
already selected by any query that reads the entry.

The two halves also have different lifetimes, which is the reason ADR-015 covers
only the first. The counters are overwritten on every write and an `unavailable`
verdict is synthesised with no page at all, so a Channel Telegram stops serving
loses its counters and has its latest Post id reset to zero — the same thing
that already happens to its subscriber count. Mix and density therefore vanish
for exactly the entries whose sample-derived statistics persist. A counter is a
snapshot of a page and a stale one is a lie; a sample-derived statistic is a
claim about what the Channel *did*, which stays true after it goes away.

## The arithmetic, and why the obvious version is wrong each time

**Median, not mean**, so one viral Post cannot relabel a Channel nobody reads.

**The view threshold counts measured views, not samples.** A view count is
optional on a sample Post, so twenty samples can carry one measured view between
them. Gating the median on the sample count would let that single observation
become a median and rank the Channel on it, which is the exact failure the
threshold exists to prevent.

**Posts per week counts intervals, not Posts.** N Posts spanning oldest to
newest give **N-1** intervals. Five Posts one week apart span four weeks and
describe a weekly Channel; `5 / 4` reports 1.25 per week, and every Channel in
the report reads busier than it is, with the error growing as samples shrink.

**The span is what the samples cover**, not a fixed trailing window and not the
Channel's lifetime. A fixed window reads zero for anything dormant, which only
repeats what last post age already says; a lifetime average hides every change
in behaviour the Channel had. Span-based means "when this Channel is active, it
posts this often", which paired with last post age is honest in both directions.

**Script reads captions, never the stored text.** A media Post with no caption
is stored with synthesised stand-in text — `[photo]`, `[video]`, `[photo
album]` — which is ASCII, so a character-range heuristic run over it would label
a caption-less Persian or Russian photo Channel as Latin. The Channels most
likely to be caption-less are exactly the image-heavy ones. Reading `caption`
off the media block rather than `text` excludes every placeholder by
construction: the parser records a caption only where the Post actually had one,
so a Post with no media block at all is the one case where `text` *is* the
caption.

**The mix is a share of the counters against each other, with no denominator.**
The obvious construction — each counter over the Post count, as a percentage —
does not survive the data. Those counters come from Telegram's channel info bar
and count **media items, not Posts**, so an album of five photos adds five and a
Post carrying a photo and a link counts in both. The latest Post id is no better
a denominator, since deleted and service messages consume ids. Inflated on both
sides it is not a percentage, and presenting it as one would be lying with a
number. `media_density` carries the media-heavy insight separately, as a rate
that is allowed to exceed 1.

**An empty sample set returns absent statistics, not zeroes.** Zero Posts per
week and no measurement are different claims.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from app.services.post_media_parser import parse_abbreviated_count

#: How many samples a rate needs before it is reported at all.
#:
#: One constant, not a confidence model and not an error bar. A median over
#: three Posts is a number pretending to be a measurement, and without a floor a
#: three-Post Channel outranks a real one in a sort. Below it the raw sample
#: count still shows, so a suppressed rate can explain itself.
MIN_SAMPLES = 5

_WEEK_MS = 7 * 24 * 60 * 60 * 1000


class SamplePost(Protocol):
    """The four attributes both `DirectorySample` and `Post` carry.

    Structural rather than a base class, because the two models are deliberately
    separate tables (see `channel_directory_samples`) and neither should grow a
    dependency on the other to satisfy this transform.
    """

    text: str
    timestamp: int
    forwarded_from: str | None
    media: dict[str, Any] | None


@dataclass(frozen=True)
class SampleStatistics:
    """The six values stored on a Directory entry.

    Every one is optional, and `None` always means *not measured* rather than
    zero. `sample_count` is `None` only for an empty set — a set below
    `MIN_SAMPLES` reports its count with the rates suppressed, which is what
    lets a row explain why it shows no cadence.
    """

    last_post_at: datetime | None = None
    sample_count: int | None = None
    posts_per_week: float | None = None
    median_views: int | None = None
    forward_share: float | None = None
    script: str | None = None


#: Character ranges per script, in the order they are tested.
#:
#: Alphabets rather than languages, and only the ones a Telegram corpus actually
#: separates into: Persian and Arabic share a script and are reported as one,
#: because distinguishing them needs a language model and this is a `str.
#: __contains__` over ranges. Latin is last because it is the fallback every
#: other script's punctuation and digits fall into.
_SCRIPT_RANGES: tuple[tuple[str, tuple[tuple[int, int], ...]], ...] = (
    (
        "arabic",
        ((0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)),
    ),
    ("cyrillic", ((0x0400, 0x04FF), (0x0500, 0x052F))),
    ("hebrew", ((0x0590, 0x05FF),)),
    ("greek", ((0x0370, 0x03FF),)),
    ("devanagari", ((0x0900, 0x097F),)),
    ("cjk", ((0x3040, 0x30FF), (0x4E00, 0x9FFF), (0xAC00, 0xD7AF))),
    ("latin", ((0x0041, 0x005A), (0x0061, 0x007A), (0x00C0, 0x024F))),
)


def _script_of(char: str) -> str | None:
    code = ord(char)
    for name, ranges in _SCRIPT_RANGES:
        if any(low <= code <= high for low, high in ranges):
            return name
    return None


def _caption(post: SamplePost) -> str | None:
    """The Post's own words, or `None` when it had none.

    A Post with no media block never had a caption to synthesise over, so its
    `text` is what was written. A Post *with* one carries its caption in the
    media block if it had any at all — the parser writes the key only where a
    caption was found — so an absent key is a placeholder and reads as no words
    rather than as ASCII ones.
    """
    if post.media is None:
        return post.text or None
    caption = post.media.get("caption")
    return caption if isinstance(caption, str) and caption else None


def _dominant_script(posts: Sequence[SamplePost]) -> str | None:
    tally: dict[str, int] = {}
    for post in posts:
        caption = _caption(post)
        if not caption:
            continue
        for char in caption:
            script = _script_of(char)
            if script is not None:
                tally[script] = tally.get(script, 0) + 1
    if not tally:
        return None
    return max(tally, key=lambda name: tally[name])


def _measured_views(posts: Sequence[SamplePost]) -> list[int]:
    out: list[int] = []
    for post in posts:
        if post.media is None:
            continue
        count = post.media.get("viewsCount")
        if isinstance(count, int):
            out.append(count)
    return out


def compute_sample_statistics(posts: Sequence[SamplePost]) -> SampleStatistics:
    """The six sample-derived statistics, or absent ones for an empty set."""
    if not posts:
        return SampleStatistics()

    timestamps = sorted(post.timestamp for post in posts)
    count = len(posts)
    span_ms = timestamps[-1] - timestamps[0]

    # `(N - 1) / span`, and a zero span yields nothing rather than a division by
    # zero: a Channel can post an album as several messages inside one second,
    # so this is reachable well above the threshold.
    posts_per_week: float | None = None
    if count >= MIN_SAMPLES and span_ms > 0:
        posts_per_week = (count - 1) / (span_ms / _WEEK_MS)

    views = _measured_views(posts)
    # Rounded, not widened: the counts are themselves parsed from Telegram's
    # abbreviated display strings, where `9.74K` becomes 9,740, so the half view
    # an even set produces sits below the precision of the input.
    median_views = (
        round(statistics.median(views)) if len(views) >= MIN_SAMPLES else None
    )

    forward_share: float | None = None
    if count >= MIN_SAMPLES:
        forward_share = sum(1 for p in posts if p.forwarded_from) / count

    return SampleStatistics(
        last_post_at=datetime.fromtimestamp(timestamps[-1] / 1000, tz=UTC).replace(
            tzinfo=None
        ),
        sample_count=count,
        posts_per_week=posts_per_week,
        median_views=median_views,
        forward_share=forward_share,
        script=_dominant_script(posts),
    )


#: The counters the mix is a share of, in the order the bar renders them.
MEDIA_COUNTERS = ("photos", "videos", "files", "links")


def media_mix(counters: dict[str, str | None]) -> dict[str, float] | None:
    """The four counters as shares of each other, summing to 1.

    `None` when the page showed no counters at all, which is not the same as a
    Channel that publishes nothing: Telegram omits a counter it has none of, so
    a photo-only Channel is a mix of `{"photos": 1.0}` and a Channel we never
    read a page for has no mix.

    A missing counter is left out rather than written as zero, so the keys are
    the counters Telegram actually showed.
    """
    parsed = {
        name: value
        for name in MEDIA_COUNTERS
        if (value := parse_abbreviated_count(counters.get(name))) is not None
    }
    total = sum(parsed.values())
    if not total:
        return None
    return {name: value / total for name, value in parsed.items()}


def media_density(counters: dict[str, str | None], latest_id: int) -> float | None:
    """Media items per published Post id — a rate, deliberately not a percentage.

    Allowed to exceed 1, and it routinely does: an album of five photos adds
    five items against one id. That is the point. It answers "is this Channel
    media-heavy or text-heavy", which the mix cannot, and it is labelled a rate
    so a value above 1 reads correctly rather than as a broken percentage.

    `None` when the entry has no latest Post id, which is every entry the
    Directory seed created and every entry whose page has gone away.
    """
    if latest_id <= 0:
        return None
    total = sum(
        value
        for name in MEDIA_COUNTERS
        if (value := parse_abbreviated_count(counters.get(name))) is not None
    )
    if not total:
        return None
    return total / latest_id
