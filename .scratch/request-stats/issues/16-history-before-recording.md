# RQS-16: History before recording

**What to build:** Ranges that reach before recording started show the ledger's own daily totals, so the tab's history doesn't start at launch. Spec: "The API" (History before recording).

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-06

**Status:** done

- [x] For days before the first recorded Request, the Breakdown and Trend endpoints serve the ledger's charged daily totals per Account and Budget and the probe daily totals, with no Channel or outcome.
- [x] The tab draws them in the stat strip, the kind table and both trends, and says those days have no Channel or outcome.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup. Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-24: implemented on `claude/rqs-16` and merged into the integration branch in 0ad84c038d3df6e634c24d8e9849a059a58f7be7 (fast-forward). Ledger history arrives as `ledgerOnly` on each kind, Account and trend bucket.
  Open: a Follow cannot be told apart in the ledger and is filed under Manual bulk; the range picker's spread still starts at the first recorded day; leaving out the Directory probes row also drops probe history. Raised at the code review.
