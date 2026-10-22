# RQS-15: The ledger check

**What to build:** Each day's recorded charged totals equal the quota ledger, per Account and Budget, checked by a test and by a daily job. Spec: "The ledger".

**Blocked by:** RQS-14

**Status:** ready-for-agent

- [ ] A test runs syncs and a bulk follow and asserts the charged daily totals equal `tg_quota_usage`.
- [ ] A daily job after each UTC day closes compares the two and logs a warning and emits a metric on any mismatch; a clean day stays quiet.
- [ ] The ledger, enqueue and the ceilings are unchanged.
- [ ] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
