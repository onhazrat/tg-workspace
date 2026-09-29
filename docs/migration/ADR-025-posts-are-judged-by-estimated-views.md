# ADR-025: Posts are filtered and ordered by their Estimated View count

**Status:** Accepted (2026-09-30). Extends ADR-024. Spec: `.scratch/post-filter-bar/spec.md`.

## Context

The Posts feed is to filter by views ("at least 10K") and order by them ("most views"). ADR-024
stores each Post's View count as an observation with a time, and fits a Settling curve from those
observations daily. Until now the curve has one use: estimating a Channel's Reach when too few of
its recent Posts are Settled.

A raw View count is a poor thing to filter a feed on. On staging a Post under 3 hours old holds
about 0.20 of the View count it settles at, and 0.86 by 12 to 24 hours. "At least 10K" on raw
counts therefore hides almost every Post from today and keeps yesterday's, which reads as a filter
on age rather than on audience. The Analysis window makes this worse, not better: a Live window over
the last few hours holds nothing but young Posts.

Channel Reach was considered as the measure and rejected for the feed. It describes the Channel,
not the Post, so it cannot tell a Channel's one widely read Post from its ignored ones. It is also
computed in Python on read (ADR-024), so filtering or ordering a paged SQL feed on it would mean
either storing it on every Channel or recomputing it for every Channel in scope on every page.

## Decision

**A Post has an Estimated View count, and the feed filters and orders by it or by the raw View
count, at the Account's choice. Channel Reach is not a feed filter or order.**

- The Estimated View count is the Post's View count once the Post is at least the settling age
  old. For a younger Post observed at or after the estimation floor, it is the View count divided
  by the current Settling curve's share at the Post's age when it was observed.
- Below the estimation floor it is **null: too new to judge.** This is the same floor `reach.py`
  already refuses to estimate below, for the same reason: at 0.20 of its settled value, a small
  error in a young count becomes a large error in the estimate. A null never matches a views
  threshold and sorts last in both views orders. The feed reports how many Posts a threshold hid
  this way, so an empty young window explains itself.
- It is **computed per request, not stored**: an SQL expression built from the current curve (the
  newest fit, or the seed curve before the first) and the reach settings. The curve changes daily
  and only Posts under the settling age are affected, so a stored value would need rewriting daily
  and would be stale in between.
- The same function has three implementations (the Python reach module, the SQL expression, and a
  browser twin for semantic results), held together by one shared fixture table asserted against
  all three.
- `views_count` stays unindexed, as ADR-024 left it, so the counter refresh stays a HOT update.
  The views orders sort the rows of the Scope, which the Analysis window already bounds.

## Consequences

- An Account can ask for "the Posts people are seeing" in a Live window and get today's Posts, not
  yesterday's.
- A Post's place in a views order can move from one day to the next without its View count changing,
  because the curve it is read through was refitted. Accepted: the estimate is a reading, and the
  raw View count stays one tab away.
- The newest Posts in any window (under 3 hours by default) drop out of an Estimated views filter.
  The footer count and the raw Views tab are the answer.
- Three implementations of one formula can drift. The shared fixture is the guard; a fourth caller
  adds a fourth assertion rather than a fourth copy.
- A views-ordered page sorts every row in scope. If a measurement on staging's largest account shows
  that sort dominating, an index or a stored estimate is the next step, and it costs the HOT update.

## Considered options

- **Raw View count only.** Simplest, and exactly what Telegram shows, but it filters on age by
  accident. Kept as the second tab, not the only one.
- **Channel Reach as the measure.** Describes the source rather than the Post, and needs either a
  stored per-Channel value or a per-page recompute.
- **Estimate below the floor anyway.** Fills the young window with numbers that are mostly error.
- **Store the estimate per Post.** Needs a daily rewrite of every young Post after the refit, and an
  index on it would end the HOT update on every counter refresh.
