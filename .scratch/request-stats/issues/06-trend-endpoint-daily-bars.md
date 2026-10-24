# RQS-06: The trend endpoint and the daily bars

**What to build:** The tab shows a daily bar trend for the range, served by a trend endpoint that returns buckets at the finest tier for each stretch. Spec: "The API" (Trend) and the daily bar trend.

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-03

**Status:** done

- [x] Trend endpoint: Operator-only, same filters as the Breakdown; 5-minute buckets from per-Request rows inside the last week, hourly inside the month, daily before; each bucket carries its span and counts by kind × outcome.
- [x] Daily bar trend (Recharts) on the tab, following the range, Charged/Uncharged, hidden kinds and outcomes, and the Channels left out; clicking a day narrows the range to it.
- [x] A note says hourly totals are kept for `REQUEST_HOURLY_DAYS` days.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup. Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23 (lead): after RQS-02, a range cut to the minute older than `REQUEST_RECORD_DAYS` finds no per-Request rows for its partial hours. Both the trend and the Breakdown should fall back to the hourly tier there (the spec's "finest tier covering each stretch"), not read nothing.
- 2026-10-23: implemented on `claude/rqs-06` and merged into the integration branch in 8fcb3076aa05c272be1859638bdcdb1b1912117b (fast-forward). The minute-cut fallback is `_widen`, in both the trend and the Breakdown.
  Open: the Channels-left-out part of box 2 waits on RQS-04, which adds them to `_filtered` in `services/request_stats.py` (both endpoints pick it up).
