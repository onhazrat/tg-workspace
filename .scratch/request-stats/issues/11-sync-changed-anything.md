# RQS-11: Sync pages say whether they changed anything

**What to build:** A sync page that moved a stored Post's counters, changed its text, or changed the Channel's metadata is Useful, not Idle. Spec: "Outcome".

**Blocked by:** RQS-01

**Status:** ready-for-agent

- [x] The counter refresh reports whether any value moved.
- [x] The initial-pass upsert reports whether any stored Post's text changed.
- [x] The metadata refresh reports whether anything changed.
- [x] A page is Useful when any of these or a new Post happened, Idle otherwise.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23 (lead): `test_request_stats.py::test_a_syncs_pictures_are_its_kind_and_uncharged` failed once in a full suite run (0 media records instead of 1) and passed alone and on rerun. This ticket works in the same recording path: find whether it is a flush or ordering race and fix it at the cause.
