# 02: A Candidate row that decides

**What to build:** An Operator can triage a Discovery report by scanning it. Each Candidate row
shows when the Channel last posted, how big it is, how often it posts, how many people read it,
and what shape of media it publishes, and the report sorts by any of those.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A Candidate row shows last post age, subscribers, posts per week and median views
- [ ] A Candidate row shows the Channel's media mix as a small stacked bar, readable in both
      themes
- [ ] Posts per week is labelled as a recent rate, so it is not read as current activity alone
- [ ] The report sorts by each of those, and null sorts last on every key
- [ ] A Channel with fewer than five sample Posts shows its Post count and no rates, rather than
      a median computed from three numbers
- [ ] A Candidate that has never been probed reads as "not probed yet", never as a bad score
- [ ] A Channel that stopped being probed keeps the statistics from its last probe, so a long
      dead Channel still reads as long dead after its sample Posts are collected
- [ ] Entries probed before this ticket already carry statistics on the day it ships
- [ ] Forward share, script and media density are computed and stored, but appear on no row
- [ ] Sample Post bodies do not travel with the report
- [ ] A report loads no slower than it does today

## The shape of the work

One **pure transform** module, declaring its service kind, taking a list of Posts plus the four
counters and the latest Post id. It takes Posts and not a Directory entry so the Channels tab can
later point it at the corpus without a second implementation of the same nine formulas.

Nine columns on the Directory entry, written at probe time by the aggregate that already writes
the samples, in the same transaction. A migration backfills every entry that already has samples.
ADR-015 argues why stored and not derived.

The four counters are already on the report wire and are dropped by the frontend type, so the mix
bar costs no new backend field beyond the columns.

## What the statistics are

Last post at, posts per week, median views, forward share, script, a four-part media mix, and
media density. Subscribers already exists and is not recomputed.

**Median, not mean**, so one viral Post cannot relabel a Channel nobody reads.

**Posts per week is measured over the span the samples cover**, not a fixed trailing window and
not the Channel's lifetime. A fixed window reads zero for anything dormant, which only repeats
what last post age says; a lifetime average hides every change in behaviour the Channel had. The
span-based rate means "when this Channel is active, it posts this often", and paired with last
post age it is honest in both directions.

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

A conclusive probe stores all nine. The next conclusive probe replaces them. An `unavailable`
verdict clears them alongside the samples it already clears. An inconclusive fetch touches
neither. The metadata refresh on a followed Channel's sync updates counters and leaves the
statistics alone, because that fetch carries no sample Posts.

## Seams

The pure transform for the arithmetic, the probe write path for storage, the API projection test
for the wire, and the frontend candidate library for ordering. Four, one of them new. Mutation-test
each guard before trusting it.
