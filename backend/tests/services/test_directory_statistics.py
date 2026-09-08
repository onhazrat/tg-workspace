"""The arithmetic a Candidate row is ranked on (ticket 02, ADR-015).

Every case here is a way the obvious implementation is wrong, which is why this
file exists at all: the formulas are three lines each, and three lines each is
exactly how "Posts divided by span" and "median over three numbers" get written.

The transform is pure, so this needs no database and no fixtures. The Posts are
real `DirectorySample` rows built in memory rather than stand-in objects,
because the fields the transform reads are the fields the probe path writes, and
a stub would let those two drift apart silently.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.models_tg import DirectorySample
from app.services.directory_statistics import (
    MIN_SAMPLES,
    compute_sample_statistics,
    media_density,
    media_mix,
)

DAY_MS = 24 * 60 * 60 * 1000
WEEK_MS = 7 * DAY_MS
#: 2026-01-01T00:00:00Z, so the assertions read as dates rather than as epochs.
ORIGIN = 1_767_225_600_000


def sample(
    post_id: int,
    *,
    timestamp: int = ORIGIN,
    caption: str | None = None,
    views: int | None = None,
    forwarded_from: str | None = None,
    media: dict[str, Any] | None = None,
    text: str = "",
) -> DirectorySample:
    """One sample Post, shaped as `replace_samples` stores it.

    `media` defaults to whatever `caption` and `views` imply, which is the
    parser's own behaviour: it writes `caption` only where the Post had one, and
    `viewsCount` only where Telegram rendered a counter. Passing `media=None`
    explicitly is the plain-text Post with no counters at all, whose stored
    `text` is its own words.
    """
    if media is None and (caption is not None or views is not None):
        media = {"kinds": ["photo"], "isMediaOnly": caption is None}
        if caption is not None:
            media["caption"] = caption
        if views is not None:
            media["viewsCount"] = views
    return DirectorySample(
        handle="h",
        post_id=post_id,
        text=text or caption or "",
        timestamp=timestamp,
        forwarded_from=forwarded_from,
        media=media,
    )


def weekly(count: int, **kwargs: Any) -> list[DirectorySample]:
    """`count` Posts exactly one week apart, newest last."""
    return [sample(i, timestamp=ORIGIN + i * WEEK_MS, **kwargs) for i in range(count)]


class TestEmpty:
    def test_no_samples_measures_nothing(self) -> None:
        """Absent, never zero. "Posts nothing" and "we did not look" are
        different claims and a sort must not rank them together."""
        stats = compute_sample_statistics([])
        assert stats.last_post_at is None
        assert stats.sample_count is None
        assert stats.posts_per_week is None
        assert stats.median_views is None
        assert stats.forward_share is None
        assert stats.script is None


class TestPostsPerWeek:
    def test_five_posts_a_week_apart_is_one_per_week(self) -> None:
        """The whole reason this is not `count / span`.

        Five Posts one week apart span **four** weeks and describe a weekly
        Channel. Dividing the Post count by the span reports 1.25, so every
        Channel in a report reads 25% busier than it is — and the error grows as
        the sample shrinks, which is exactly where it is least visible.
        """
        assert compute_sample_statistics(weekly(5)).posts_per_week == 1.0

    def test_a_zero_span_yields_no_rate_rather_than_dividing_by_zero(self) -> None:
        """Reachable well above the threshold: a Channel posts an album as
        several messages inside the same second, and a probe reads twenty of
        them off one page."""
        rows = [sample(i) for i in range(MIN_SAMPLES + 3)]
        stats = compute_sample_statistics(rows)
        assert stats.posts_per_week is None
        assert stats.sample_count == MIN_SAMPLES + 3

    def test_below_the_threshold_the_rate_is_suppressed_and_the_count_is_not(
        self,
    ) -> None:
        """A cadence from four Posts is a number pretending to be a measurement.
        The count still shows, so the blank rate explains itself."""
        stats = compute_sample_statistics(weekly(MIN_SAMPLES - 1))
        assert stats.posts_per_week is None
        assert stats.sample_count == MIN_SAMPLES - 1
        assert stats.last_post_at is not None

    def test_the_span_is_what_the_samples_cover(self) -> None:
        """Not a fixed trailing window: five Posts a day apart over a stretch
        that ended a year ago still report five per week, and last post age is
        what says the Channel is dead. A window-based rate would report zero and
        merely repeat what the age already said."""
        long_ago = ORIGIN - 400 * DAY_MS
        rows = [sample(i, timestamp=long_ago + i * DAY_MS) for i in range(5)]
        assert compute_sample_statistics(rows).posts_per_week == 7.0


class TestMedianViews:
    def test_the_threshold_counts_measured_views_not_samples(self) -> None:
        """Twenty samples carrying one view between them measure nothing.

        Gating on the sample count would let that single observation *be* the
        median and rank the Channel on it, which is the failure the threshold
        exists to prevent — and it is the common shape, because Telegram stops
        rendering a view counter on older Posts.
        """
        rows = weekly(20)
        rows[0].media = {"kinds": [], "viewsCount": 99_000}
        stats = compute_sample_statistics(rows)
        assert stats.median_views is None
        assert stats.sample_count == 20

    def test_one_viral_post_does_not_move_the_median(self) -> None:
        """Median, not mean: the mean of these is 20,180."""
        rows = [sample(i, views=v) for i, v in enumerate([100, 110, 120, 130, 100_000])]
        assert compute_sample_statistics(rows).median_views == 120

    def test_an_even_set_rounds(self) -> None:
        """An even set has a fractional median — 30 and 41 give 35.5 — and the
        column is an int. Rounding rather than widening the type: the counts are
        themselves parsed from Telegram's abbreviated display strings, where
        `9.74K` becomes 9,740, so half a view is below the precision of the
        input. Which way a tie breaks is `round`'s business and nobody's
        concern at this precision."""
        rows = [sample(i, views=v) for i, v in enumerate([10, 20, 30, 41, 50, 60])]
        assert compute_sample_statistics(rows).median_views == 36

    def test_exactly_the_threshold_measures(self) -> None:
        rows = [sample(i, views=(i + 1) * 10) for i in range(MIN_SAMPLES)]
        assert compute_sample_statistics(rows).median_views == 30


class TestForwardShare:
    def test_it_counts_attributions(self) -> None:
        rows = weekly(5)
        rows[0].forwarded_from = "source_a"
        rows[1].forwarded_from = "source_b"
        assert compute_sample_statistics(rows).forward_share == 0.4

    def test_below_the_threshold_it_is_suppressed(self) -> None:
        rows = weekly(4)
        rows[0].forwarded_from = "source_a"
        assert compute_sample_statistics(rows).forward_share is None

    def test_an_original_channel_shares_zero_rather_than_nothing(self) -> None:
        """Zero is a measurement here, unlike the absent statistics: five Posts
        with no attribution between them is evidence the Channel writes its
        own."""
        assert compute_sample_statistics(weekly(5)).forward_share == 0.0


class TestScript:
    def test_placeholders_yield_no_script_rather_than_latin(self) -> None:
        """The case that motivates reading captions instead of the stored text.

        A caption-less media Post is stored as `[photo]`, which is ASCII, so a
        heuristic over the text would label a Persian photo Channel Latin — and
        caption-less Channels are exactly the image-heavy ones this would
        otherwise describe well.
        """
        rows = [
            sample(i, text="[photo]", media={"kinds": ["photo"], "isMediaOnly": True})
            for i in range(5)
        ]
        assert compute_sample_statistics(rows).script is None

    def test_it_separates_the_alphabets_the_corpus_contains(self) -> None:
        cases = {
            "arabic": "سلام دنیا این یک کانال است",
            "cyrillic": "Привет мир это канал",
            "latin": "Hello world this is a channel",
            "hebrew": "שלום עולם זה ערוץ",
            "greek": "Γεια σου κόσμε αυτό είναι κανάλι",
            "cjk": "你好世界这是一个频道",
        }
        for expected, caption in cases.items():
            rows = [sample(i, caption=caption) for i in range(5)]
            assert compute_sample_statistics(rows).script == expected

    def test_latin_punctuation_does_not_outvote_the_caption(self) -> None:
        """A Persian caption carrying a URL and an @handle is still Persian.
        Digits and punctuation belong to no script and are not counted at all,
        which is what keeps the majority honest on short captions."""
        rows = [sample(i, caption="کانال ما — t.me/x (۱۴۰۳) @ch") for i in range(5)]
        assert compute_sample_statistics(rows).script == "arabic"

    def test_a_post_with_no_media_block_is_read_as_its_own_words(self) -> None:
        """The one case where the stored text *is* the caption: a plain-text
        Post with no counters has no media block for a caption to live in."""
        rows = [sample(i, media=None, text="Привет") for i in range(5)]
        assert compute_sample_statistics(rows).script == "cyrillic"

    def test_one_caption_is_enough(self) -> None:
        """No threshold on the script. Unlike the rates it is a label rather
        than a measurement, and one real caption beats guessing."""
        rows = [
            sample(0, caption="Привет мир"),
            *[
                sample(
                    i, text="[photo]", media={"kinds": ["photo"], "isMediaOnly": True}
                )
                for i in range(1, 5)
            ],
        ]
        assert compute_sample_statistics(rows).script == "cyrillic"


class TestLastPostAt:
    def test_it_is_the_newest_sample_whatever_order_they_arrive_in(self) -> None:
        rows = [
            sample(1, timestamp=ORIGIN),
            sample(3, timestamp=ORIGIN + 2 * DAY_MS),
            sample(2, timestamp=ORIGIN + DAY_MS),
        ]
        stats = compute_sample_statistics(rows)
        assert stats.last_post_at == datetime.fromtimestamp(
            (ORIGIN + 2 * DAY_MS) / 1000, tz=UTC
        ).replace(tzinfo=None)


class TestMediaMix:
    def test_the_four_counters_are_shares_of_each_other(self) -> None:
        mix = media_mix({"photos": "50", "videos": "25", "files": "15", "links": "10"})
        assert mix == {"photos": 0.5, "videos": 0.25, "files": 0.15, "links": 0.1}
        assert mix is not None and sum(mix.values()) == 1.0

    def test_a_missing_counter_is_left_out_rather_than_zeroed(self) -> None:
        """Telegram omits a counter it has none of, so the keys are what the
        page actually showed. A zero would claim we read a counter of zero."""
        mix = media_mix({"photos": "3", "videos": None, "files": None, "links": "1"})
        assert mix == {"photos": 0.75, "links": 0.25}

    def test_no_counters_at_all_is_no_mix(self) -> None:
        assert media_mix({}) is None
        assert media_mix({"photos": None, "videos": None}) is None

    def test_it_needs_no_latest_id_so_a_seeded_entry_still_has_one(self) -> None:
        """The reason the mix and the density are two statistics rather than
        one. The Directory seed stamped every already-synced Channel with a
        latest Post id of zero, which leaves density undefined and the mix
        perfectly readable."""
        assert media_mix({"photos": "2", "videos": "2"}) == {
            "photos": 0.5,
            "videos": 0.5,
        }

    def test_abbreviated_counters_are_parsed(self) -> None:
        mix = media_mix({"photos": "1.5K", "videos": "500"})
        assert mix == {"photos": 0.75, "videos": 0.25}


class TestMediaDensity:
    def test_it_is_a_rate_and_may_exceed_one(self) -> None:
        """An album of five photos adds five items against one Post id, so a
        media-heavy Channel reads above 1. Presenting this as a percentage is
        the error the mix/density split exists to avoid."""
        assert media_density({"photos": "300", "videos": "100"}, 200) == 2.0

    def test_no_latest_id_is_no_density(self) -> None:
        assert media_density({"photos": "300"}, 0) is None

    def test_no_counters_is_no_density(self) -> None:
        assert media_density({"photos": None}, 500) is None
