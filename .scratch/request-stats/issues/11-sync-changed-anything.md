# RQS-11: Sync pages say whether they changed anything

**What to build:** A sync page that moved a stored Post's counters, changed its text, or changed the Channel's metadata is Useful, not Idle. Spec: "Outcome".

**Blocked by:** RQS-01

**Status:** ready-for-agent

- [ ] The counter refresh reports whether any value moved.
- [ ] The initial-pass upsert reports whether any stored Post's text changed.
- [ ] The metadata refresh reports whether anything changed.
- [ ] A page is Useful when any of these or a new Post happened, Idle otherwise.
- [ ] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
