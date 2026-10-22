# RQS-16: History before recording

**What to build:** Ranges that reach before recording started show the ledger's own daily totals, so the tab's history doesn't start at launch. Spec: "The API" (History before recording).

**Blocked by:** RQS-06

**Status:** ready-for-agent

- [ ] For days before the first recorded Request, the Breakdown and Trend endpoints serve the ledger's charged daily totals per Account and Budget and the probe daily totals, with no Channel or outcome.
- [ ] The tab draws them in the stat strip, the kind table and both trends, and says those days have no Channel or outcome.
- [ ] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup. Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
