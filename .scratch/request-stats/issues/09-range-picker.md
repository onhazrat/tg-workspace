# RQS-09: The Requested range picker

**What to build:** Inside the time bound, a spread shows when Requests were made, so the Operator can pick a burst precisely. Spec: "Filter bar".

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-03

**Status:** done

- [x] A Spread endpoint over everything kept, Operator-only.
- [x] The spread uses the app's bar histogram and zoom controls: 7-day and 30-day edges marked, drag-select sets the range, scroll and a scrollbar move a zoomed spread, arrow keys step it.
- [x] A full-screen button next to zoom in and out opens the spread full screen, keeping the zoom.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup. Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23: implemented on `claude/rqs-09` and merged into the integration branch in aa6daaac793b9cfc93a5231d6369eb33d3c5abae (fast-forward). The spread is `GET /requests/spread` (hourly inside the hourly span, daily before); the Playwright mocks serve it inside `mockBreakdown`.
