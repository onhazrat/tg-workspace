# RQS-04: Channel table filters, yield and picking

**What to build:** The Operator narrows and ranks Channels by any measure, sees each Channel's New Posts per Request, and ticks Channels to narrow the whole tab to them. Spec: "Channels by Requests".

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-03

**Status:** done

- [x] Kinds facet, Hide uncharged, and a measure filter with criteria search over every measure (Requests, Idle and Wasted counts and shares, syncs, failed syncs, new Posts, Requests per sync, New Posts per Request), whole-row or per kind, edited with the app's bound histogram and fields; sort picker; filter row.
- [x] Clicking a kind in By kind of work narrows the Channel table to Channels with that work.
- [x] New Posts / Req column: 20 is a full page, 0 nothing new; hover gives the share of a 20-Post page; aggregate rows show a dash and sort last either way.
- [x] A pick checkbox on every row and one in the header for every listed row, all ticked by default; the rows left out leave the whole tab (an API parameter), stay listed and faded; the footer says "N Channels left out" with Pick all.
- [x] Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet). Backend: the Breakdown endpoint honours the Channels left out, at seam 1.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23 (lead): RQS-01 left syncs and failed syncs out of the Breakdown because nothing records them yet. The measures here need them: record them (a sync run and whether it failed) and add them to the Breakdown rows as part of this ticket.
- 2026-10-23 (lead): RQS-06 left the trend's Channels-left-out filter to you: add the left-out Channels to `_filtered` in `services/request_stats.py` and both the Breakdown and the trend follow; tick RQS-06's box 2 when done.
- 2026-10-23: implemented on `claude/rqs-04` and merged into the integration branch in 77a647ac95cc0f142a274202c7c45ae55d6e93bc (fast-forward). Syncs are recorded by `sync_run()` (one held-back Request per Channel sync, marked failed or not); the left-out filter is `leftOut` plus `leftOutKinds`. A sync that made no Request is not counted.
