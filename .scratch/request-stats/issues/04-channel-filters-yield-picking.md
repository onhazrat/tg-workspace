# RQS-04: Channel table filters, yield and picking

**What to build:** The Operator narrows and ranks Channels by any measure, sees each Channel's New Posts per Request, and ticks Channels to narrow the whole tab to them. Spec: "Channels by Requests".

**Blocked by:** RQS-03

**Status:** ready-for-agent

- [ ] Kinds facet, Hide uncharged, and a measure filter with criteria search over every measure (Requests, Idle and Wasted counts and shares, syncs, failed syncs, new Posts, Requests per sync, New Posts per Request), whole-row or per kind, edited with the app's bound histogram and fields; sort picker; filter row.
- [ ] Clicking a kind in By kind of work narrows the Channel table to Channels with that work.
- [ ] New Posts / Req column: 20 is a full page, 0 nothing new; hover gives the share of a 20-Post page; aggregate rows show a dash and sort last either way.
- [ ] A pick checkbox on every row and one in the header for every listed row, all ticked by default; the rows left out leave the whole tab (an API parameter), stay listed and faded; the footer says "N Channels left out" with Pick all.
- [ ] Tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet). Backend: the Breakdown endpoint honours the Channels left out, at seam 1.
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
