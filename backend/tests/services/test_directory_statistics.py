"""The arithmetic a Candidate row is ranked on (ticket 02, ADR-015).

Every case here is a way the obvious implementation is wrong, which is why this
file exists at all: the formulas are three lines each, and three lines each is
exactly how "Posts divided by span" and "median over three numbers" get written.

The transform is pure, so this needs no database and no fixtures. The Posts are
real `DirectorySample` rows built in memory rather than stand-in objects,
because the fields the transform reads are the fields the probe path writes, and
a stub would let those two drift apart silently.

## Watched to fail

* `count / span` instead of `(count - 1) / span` -> the weekly case reads 1.25
  and the year-old case 8.75
* gate the median on `count` rather than on how many samples carry a view ->
  twenty samples with one view between them report that one view as a median
* read `post.text` instead of the parsed caption -> a set of `[photo]`
  placeholders reports a Language where it has none
* derive over the samples as stored rather than newest first -> the tie test
  reads `en` in one of its two orders
* `floor(x + 0.5)` instead of `round` -> the tie test reads 11, and the
  write-path file's agreement test fails against the migration's own SQL
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
        assert stats.language is None


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

    def test_a_tie_goes_to_the_even_integer_because_the_migration_does(
        self,
    ) -> None:
        """The one input where the two implementations of this could disagree.

        `[10, 11]` has a median of 10.5, and which way that breaks is invisible
        until you notice the backfill says this formula a second time in SQL.
        Python's `round` and PostgreSQL's `round(double precision)` are both
        `rint` and both answer 10, so they agree — but half-up here, or a
        `::numeric` cast there, would part them. Pinned from this side; the
        write-path file pins the same tie through the migration's own statement.
        """
        rows = [sample(i, views=v) for i, v in enumerate([8, 9, 10, 11, 12, 13])]
        assert compute_sample_statistics(rows).median_views == 10

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


PERSIAN = "امروز جلسه شورای شهر برگزار شد و درباره بودجه سال آینده گفتگو کردند"
ARABIC = "عقد مجلس المدينة اليوم اجتماعا لمناقشة ميزانية العام المقبل والمشاريع الجديدة"
ENGLISH = "The city council met today to discuss next year's budget and new projects"


def photo(post_id: int, **kwargs: Any) -> DirectorySample:
    """A caption-less photo, stored as its placeholder."""
    return sample(
        post_id,
        text="[photo]",
        media={"kinds": ["photo"], "isMediaOnly": True},
        **kwargs,
    )


class TestLanguage:
    """The Channel rule over a sample, through the one reading module (LANG-05)."""

    def test_a_persian_sample_is_persian_and_an_arabic_one_arabic(self) -> None:
        """The distinction the alphabet tally could not make: both are one
        script, and it read "Arabic / Persian" for either."""
        persian = [sample(i, caption=PERSIAN) for i in range(5)]
        arabic = [sample(i, caption=ARABIC) for i in range(5)]
        assert compute_sample_statistics(persian).language == "fa"
        assert compute_sample_statistics(arabic).language == "ar"

    def test_placeholders_yield_no_language_rather_than_english(self) -> None:
        """A caption-less photo is stored as `[photo]`; reading the stored text
        would label a Persian photo Channel by its placeholders."""
        rows = [photo(i) for i in range(5)]
        assert compute_sample_statistics(rows).language is None

    def test_a_post_with_no_media_block_is_read_as_its_own_words(self) -> None:
        rows = [sample(i, media=None, text=PERSIAN) for i in range(5)]
        assert compute_sample_statistics(rows).language == "fa"

    def test_forwards_are_outvoted_by_the_channels_own_words(self) -> None:
        """A Persian Channel forwarding English news is still Persian."""
        rows = [
            sample(0, caption=PERSIAN, timestamp=ORIGIN),
            *[
                sample(
                    i, caption=ENGLISH, forwarded_from="reuters", timestamp=ORIGIN + i
                )
                for i in range(1, 5)
            ],
        ]
        assert compute_sample_statistics(rows).language == "fa"

    def test_a_sample_of_forwards_alone_still_has_a_language(self) -> None:
        rows = [sample(i, caption=ENGLISH, forwarded_from="reuters") for i in range(5)]
        assert compute_sample_statistics(rows).language == "en"

    def test_a_sample_below_the_minimum_still_has_a_language(self) -> None:
        """No threshold. The rates are suppressed below `MIN_SAMPLES`; a
        Language is a label, and a preview page of three Persian Posts still
        says Persian."""
        rows = [sample(i, caption=PERSIAN) for i in range(MIN_SAMPLES - 2)]
        stats = compute_sample_statistics(rows)
        assert stats.posts_per_week is None
        assert stats.language == "fa"

    def test_a_tie_goes_to_the_newest_post_whatever_order_they_arrive_in(
        self,
    ) -> None:
        """The Channel rule reads newest first by Post id, and samples are not
        stored in that order, so the transform has to sort them itself. The
        timestamps disagree with the ids on purpose: the Channel rule orders by
        id, so a sort by time would split a Candidate from its Channel."""
        rows = [
            sample(2, caption=PERSIAN, timestamp=ORIGIN),
            sample(1, caption=ENGLISH, timestamp=ORIGIN + DAY_MS),
        ]
        assert compute_sample_statistics(rows).language == "fa"
        assert compute_sample_statistics(list(reversed(rows))).language == "fa"


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
        mix = media_mix({"photos": 50, "videos": 25, "files": 15, "links": 10})
        assert mix == {"photos": 0.5, "videos": 0.25, "files": 0.15, "links": 0.1}
        assert mix is not None and sum(mix.values()) == 1.0

    def test_a_missing_counter_is_left_out_rather_than_zeroed(self) -> None:
        """Telegram omits a counter it has none of, so the keys are what the
        page actually showed. A zero would claim we read a counter of zero."""
        mix = media_mix({"photos": 3, "videos": None, "files": None, "links": 1})
        assert mix == {"photos": 0.75, "links": 0.25}

    def test_no_counters_at_all_is_no_mix(self) -> None:
        assert media_mix({}) is None
        assert media_mix({"photos": None, "videos": None}) is None

    def test_it_needs_no_latest_id_so_a_seeded_entry_still_has_one(self) -> None:
        """The reason the mix and the density are two statistics rather than
        one. The Directory seed stamped every already-synced Channel with a
        latest Post id of zero, which leaves density undefined and the mix
        perfectly readable."""
        assert media_mix({"photos": 2, "videos": 2}) == {
            "photos": 0.5,
            "videos": 0.5,
        }


class TestMediaDensity:
    def test_it_is_a_rate_and_may_exceed_one(self) -> None:
        """An album of five photos adds five items against one Post id, so a
        media-heavy Channel reads above 1. Presenting this as a percentage is
        the error the mix/density split exists to avoid."""
        assert media_density({"photos": 300, "videos": 100}, 200) == 2.0

    def test_no_latest_id_is_no_density(self) -> None:
        assert media_density({"photos": 300}, 0) is None

    def test_no_counters_is_no_density(self) -> None:
        assert media_density({"photos": None}, 500) is None
