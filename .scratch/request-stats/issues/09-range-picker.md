# RQS-09: The Requested range picker

**What to build:** Inside the time bound, a spread shows when Requests were made, so the Operator can pick a burst precisely. Spec: "Filter bar".

**Blocked by:** RQS-03

**Status:** ready-for-agent

- [ ] A Spread endpoint over everything kept, Operator-only.
- [ ] The spread uses the app's bar histogram and zoom controls: 7-day and 30-day edges marked, drag-select sets the range, scroll and a scrollbar move a zoomed spread, arrow keys step it.
- [ ] A full-screen button next to zoom in and out opens the spread full screen, keeping the zoom.
- [ ] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup. Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
