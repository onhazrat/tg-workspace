# RQS-03: The Requests tab: totals and tables

**What to build:** The Operator opens a new Requests tab and sees, for a range picked on top, the total Requests, their split into Useful, Idle and Wasted, a table by kind of work, and Channels ranked by Requests. Spec: "The Requests tab"; prototype variant A.

**Blocked by:** RQS-01

**Status:** ready-for-agent

- [ ] A Closable workspace tab, Requests, open at most once, offered only to the Operator, loaded lazily.
- [ ] Filter bar (the app's `FilterBar`): title, All / Charged / Uncharged with counts, and a "Requested" time bound (the app's time-bound editor, without the spread, which is RQS-09). Footer: total and the range in UTC, to the minute when cut mid-day.
- [ ] The range cuts every number on the tab to the minute.
- [ ] Stat strip: Requests, Useful, Idle, Wasted.
- [ ] By kind of work: Show checkbox, kind (uncharged marked), Requests, Share, outcome bar, Idle %, Wasted %; hidden kinds recompute the rest in proportion.
- [ ] Useful, Idle and Wasted chips hide an outcome on the whole tab; the last shown can't be hidden. Hidden kinds and outcomes are tab-wide state, so the trend can share them later.
- [ ] Channels by Requests: rank, Channel, Requests, Idle, Wasted, Idle %, Wasted %, outcome bar scaled to the busiest real Channel; Directory probes and Handle checks as aggregate rows; search; sortable columns; show 25 then 50 more; columns of a hidden outcome go.
- [ ] Kind and outcome colour tokens with icons, light and dark, from the dataviz palette.
- [ ] The Settings Usage panel links to the tab.
- [ ] No sideways scroll at phone width.
- [ ] Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
