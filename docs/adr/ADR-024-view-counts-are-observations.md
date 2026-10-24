# ADR-024: View counts are observations, and Reach is fitted from them

**Status:** Accepted (2026-09-27). Supersedes the Post-media storage part of ADR-023. Spec:
`.scratch/post-view-observations/spec.md`.

## Context

ADR-023 made every counter a number and kept a Post's `viewsCount` and `reactionCounts` inside its
media JSON. That was right for a counter written once. It is wrong now that a View count changes:
sync is to refresh the View count of every stored Post it meets again, because a Post's count at
first capture is usually hours old. On staging (2026-09-27) a Post captured under 3 hours after
publication held 0.20 of the View count it settled at, and 0.86 by 12 to 24 hours.

Reach, the median Settled View count of a Channel's recent Posts, needs Posts old enough to have
settled. A Channel posting more than 20 times a day (62 of 230 on staging) has no such Post on its
preview page and none that sync ever sees again, so its Reach has to be estimated from young counts.

## Decision

**A View count is stored as an observation with a time, refreshed while sync still meets the Post,
and Reach is computed from Settled observations or estimated through a Settling curve fitted daily
from a sample of them.**

- The View count, reaction chips and their observation time are columns on `tg_posts`, not keys in
  media. The reaction total is summed from the chips, never stored.
- Sync refreshes them for every stored Post on a scraped page until the Post is 7 days old, with a
  narrow update that touches nothing else and does not bump the posts etag.
- `tg_view_observations` keeps sightings of Posts where `(post_id - 1) % stride == 0` for 14 days
  after publication. An hourly job doubles or halves the power-of-two stride from a 6-hour
  forecast against an environment row cap, with the halving test run at doubled inflow so the two
  thresholds sit a full doubling apart.
- One global Settling curve is fitted daily: piecewise-linear log share over log age, least squares
  over consecutive observation pairs, made monotone, anchored at the settling age. Thin spans fall
  back to a seed curve in code; fits are kept forever.
- Reach is the median of a Channel's newest N Settled View counts, or, with fewer than five, an
  estimate from counts between the estimation floor and the settling age divided by the curve,
  marked as an estimate. One function serves followed Channels (from Posts, on read) and Directory
  entries (from the sample, at probe time).

## Consequences

- A View count shown in the feed trails reality by at most one sync while the Post is young, and
  freezes at 7 days, when it is at about 0.94 of its 14-day value.
- The refresh writes up to about 20 rows per sync of an active Channel. `fillfactor = 90` and
  unindexed counters keep those HOT updates.
- Fast Channels teach only the young end of the curve. The global curve covers them, and fits record
  their Channel count so a thinning sample is visible.
- The observation stride's selection is aligned with Telegram's per-Channel ids, so above stride 1 a
  Channel whose Posts always consume an even number of ids is wholly in or out. Accepted; swapping
  the rule for a hash is a change to one function.
- Stored Directory Reach uses the settling age in force at its probe and catches up on re-probe.

## Considered options

- **Patch the counters inside media JSON.** No column move, but a mutable observation inside a
  write-once blob, and every refresh rewrites the blob.
- **Keep only the first View count per Post.** Enough for a curve if refreshes never happened, but
  the refresh this ADR adds would destroy the young data the curve needs.
- **Every refresh unsampled, or one row per Post per age bucket.** The first grows with sync
  frequency and nothing bounds it; the second bounds it but throws away the continuous ages the
  fit uses. The stride bounds rows without discarding ages.
- **Bucketed curve, or a two-parameter saturation curve.** Buckets round every pair's ages; a
  Weibull-style curve fits the slow tail (0.89 at 24h, 1.0 at 14 days) badly.
- **Weigh the fit per Channel.** Rejected: every observed Post counts once.
- **Fetch an older page for fast Channels.** Spends a Request per probe on exactly the busiest
  Channels, for a number the curve estimates.
