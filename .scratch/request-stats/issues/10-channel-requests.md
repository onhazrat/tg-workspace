# RQS-10: A Channel's Requests

**What to build:** Clicking a Channel row opens its individual Requests from the last week, within the range. Spec: "The API" (A Channel's Requests).

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-03

**Status:** ready-for-agent

- [x] An endpoint returning one Channel's or aggregate row's per-Request rows within the range and the last `REQUEST_RECORD_DAYS`, newest first, paged; Operator-only.
- [x] A sheet lists time (UTC), kind, Account, Lane, outcome, cause, error code, attempt, latency, and new and repeated Posts where the page carried Posts, with counts per outcome on top.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup. Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
