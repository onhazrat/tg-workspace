# 02: A Candidate row that decides

**What to build:** An Operator can triage a Discovery report by scanning it. Each Candidate row
shows when the Channel last posted, how big it is, how often it posts, how many people read it,
and what shape of media it publishes, and the report sorts by any of those.

**Blocked by:** 01

**Status:** done

- [x] A Candidate row shows last post age, subscribers, posts per week and median views
- [x] A Candidate row shows the Channel's media mix as a small stacked bar, readable in both
      themes
- [x] Posts per week is labelled as a recent rate, so it is not read as current activity alone
- [x] The report sorts by each of those, and null sorts last on every key
- [x] A Channel with fewer than five sample Posts shows its Post count and no rates, rather than
      a median computed from three numbers
- [x] A Candidate that has never been probed reads as "not probed yet", never as a bad score
- [x] A Channel that stopped being probed keeps the statistics from its last probe, so a long
      dead Channel still reads as long dead after its sample Posts are collected
- [x] **An `unavailable` verdict keeps the statistics**, because a Channel Telegram has stopped
      serving is exactly the case ADR-015 exists to describe: "posted four times a week until
      fourteen months ago" is the useful epitaph, and clearing it would destroy the evidence on
      the only rows that cannot regenerate it
- [x] Entries probed before this ticket already carry statistics on the day it ships —
      **five of the six**. The migration restates the arithmetic in SQL rather than importing
      the transform, because an applied revision has to keep meaning what it meant, and
      `script` is a per-character tally that SQL says badly. It is also the one statistic this
      ticket puts on no row and in no sort. Every entry holding samples is `ok` and therefore
      refreshable, so all of them re-probe inside `directoryRefreshDays` and fill it in
      properly; the backfill is a bridge over that week and this column does not need one.
      `test_the_migration_backfill_agrees_with_the_transform` pins the duplication the SQL
      restatement introduced
- [x] Forward share and script are computed and stored, but appear on no row
- [x] Sample Post bodies do not travel with the report
- [x] A report loads no slower than it does today

## The shape of the work

One **pure transform** module, declaring its service kind, taking a list of Posts. It takes Posts
and not a Directory entry so the Channels tab can later point it at the corpus without a second
implementation of the same formulas.

**Six stored columns**, all of them derived from the sample Posts, written at probe time by the
aggregate that already writes the samples, in the same transaction:

| Column | Type | Null when |
|---|---|---|
| last post at | timestamp (naive UTC, as every other `tg_*` one) | no samples |
| sample count | smallint | no samples |
| posts per week | float | below the threshold, or the span is zero |
| median views | int | fewer than five samples **carry a view count** |
| forward share | float | below the threshold |
| script | text | no sample carried non-placeholder text |

A migration backfills every entry that already has samples. ADR-015 argues why these are stored.

**The media mix and the media density are not stored.** They derive from the four counters and the
latest Post id, columns already on the same row, so computing them at read costs no join and no
extra query. Storing them would be duplicated state that can disagree with its own inputs.

**They do not outlive the page, and that is deliberate.** The counters are overwritten on every
write and an `unavailable` verdict is synthesised with no page, so a Channel Telegram stops
serving loses its counters and has its latest Post id reset to zero. Mix and density therefore
vanish for exactly the entries whose sample-derived statistics persist.

That asymmetry is correct rather than an oversight, and the codebase already commits to it: the
**subscriber count is cleared on the same path today**, so a dead entry already loses it. The rule
is that a counter is a snapshot of a page and a stale one is a lie, which is why the chat id is the
single field that survives. Sample-derived statistics are a different kind of claim: they describe
what the Channel *did*, which stays true after it goes away, where "this Channel has 40,000
subscribers" does not.

So the promise is narrow and must be written that way. A dead Channel's row keeps last post age,
cadence, median views, forward share and script. It loses subscribers, the media mix and density,
as it already loses subscribers today.

## What the statistics are

**Median, not mean**, so one viral Post cannot relabel a Channel nobody reads.

**The threshold counts measured views, not samples.** A view count is optional on a sample Post,
so twenty samples can carry one measured view between them. Applying the five-sample threshold to
the sample count would let that single observation become a median and rank the Channel on it,
which is the exact failure the threshold exists to prevent. The median needs five samples that
actually carry a view count, counted separately from the sample count that gates the other rates.

**The median is rounded to an integer**, because an even set has a fractional median (`[10, 11]`
is 10.5) that the column cannot hold. Rounding rather than widening the type: the view counts are
themselves parsed from Telegram's abbreviated display strings, where `9.74K` becomes 9,740, so
half a view is noise below the precision of the input.

**Posts per week counts intervals, not Posts.** N sample Posts spanning oldest to newest give
**N-1** intervals, so the rate is `(N - 1) / span`, not `N / span`. Five Posts one week apart span
four weeks and describe a weekly Channel; dividing by Posts would report 1.25 per week and every
Channel in the report would read 25% busier than it is, with the error growing as samples shrink.
A **zero span** is possible even above the threshold, since a Channel can post an album as several
messages in the same second, so it yields no rate rather than a division by zero.

The span is what the samples cover, not a fixed trailing window and not the Channel's lifetime. A
fixed window reads zero for anything dormant, which only repeats what last post age says; a
lifetime average hides every change in behaviour the Channel had. The span-based rate means "when
this Channel is active, it posts this often", and paired with last post age it is honest in both
directions.

**Script ignores synthesised placeholder text.** A media Post with no caption is stored with
stand-in text like `[photo]`, `[video]` or `[photo album]`, which is ASCII. A character-range
heuristic run over those would label a caption-less Persian or Russian photo Channel as Latin, and
the Channels most likely to be caption-less are exactly the image-heavy ones. The transform reads
captions only and excludes the placeholders; a Channel whose every sample is a placeholder has no
script rather than a wrong one.

**The media mix is a share of the four counters against each other**, summing to 100%, with no
denominator. The obvious construction, each counter over the Post count as a percentage, does not
survive the data: those counters come from Telegram's channel info bar and count **media items,
not Posts**, so an album of five photos adds five and a Post with a photo and a link counts in
both. The latest Post id is no better as a denominator, since deleted and service messages consume
ids. Inflated on both sides it is not a percentage, and presenting it as one would be lying with a
number. **Density** carries the media-heavy insight separately, as a rate that is allowed to
exceed 1, and is absent when the latest Post id is zero.

**An empty sample set returns absent statistics, not zeroes.** Zero Posts per week and no
measurement are different claims.

## Verdict transitions

A conclusive probe stores all six. The next conclusive probe replaces them. An inconclusive fetch
touches nothing. The metadata refresh on a followed Channel's sync updates counters and leaves the
statistics alone, because that fetch carries no sample Posts.

An **`unavailable` verdict keeps the statistics**, and this is the one place the statistics and the
samples deliberately part company. The existing code clears an entry's samples on that verdict, and
copying that for the statistics would be exactly wrong: an unavailable entry stops being refreshed,
so it can never recompute them, and it is precisely the row where "posted four times a week until
fourteen months ago" is worth more than the bare verdict. The statistics are the record the samples
leave behind.

The **recheck path is the exception**: it resets a row to `unknown`, meaning the deployment has no
answer rather than a negative one, and it already clears every other metadata field. The statistics
go with them, because a row claiming no answer must not still show numbers.

## Seams

The pure transform for the arithmetic, the probe write path for storage, the API projection test
for the wire, and the frontend candidate library for ordering. Four, one of them new. Mutation-test
each guard before trusting it.

Cases the transform's tests must carry, because each is a way the obvious implementation is wrong:
five Posts one week apart give one per week and not 1.25; five Posts sharing a timestamp give no
rate rather than a division by zero; a sample set of nothing but `[photo]` placeholders yields no
script rather than Latin; twenty samples carrying one measured view yield no median; an even set
of measured views rounds; one viral Post does not move the median; a set below the threshold still
reports its count.

And through the write path, the seam between the two statistic families: an entry marked
unavailable keeps all six sample-derived statistics and has no mix and no density, because its
counters went with its page. That single test is what keeps the retention promise honest, since
the two families are stored and derived respectively and nothing else asserts they part company.
