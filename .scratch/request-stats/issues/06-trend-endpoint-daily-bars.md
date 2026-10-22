# RQS-06: The trend endpoint and the daily bars

**What to build:** The tab shows a daily bar trend for the range, served by a trend endpoint that returns buckets at the finest tier for each stretch. Spec: "The API" (Trend) and the daily bar trend.

**Blocked by:** RQS-03

**Status:** ready-for-agent

- [ ] Trend endpoint: Operator-only, same filters as the Breakdown; 5-minute buckets from per-Request rows inside the last week, hourly inside the month, daily before; each bucket carries its span and counts by kind × outcome.
- [ ] Daily bar trend (Recharts) on the tab, following the range, Charged/Uncharged, hidden kinds and outcomes, and the Channels left out; clicking a day narrows the range to it.
- [ ] A note says hourly totals are kept for `REQUEST_HOURLY_DAYS` days.
- [ ] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup. Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
