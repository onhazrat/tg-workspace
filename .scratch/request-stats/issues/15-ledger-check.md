# RQS-15: The ledger check

**What to build:** Each day's recorded charged totals equal the quota ledger, per Account and Budget, checked by a test and by a daily job. Spec: "The ledger".

**Blocked by:** RQS-14

**Status:** done

- [x] A test runs syncs and a bulk follow and asserts the charged daily totals equal `tg_quota_usage`.
- [x] A daily job after each UTC day closes compares the two and logs a warning and emits a metric on any mismatch; a clean day stays quiet.
- [x] The ledger, enqueue and the ceilings are unchanged.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23: implemented on `claude/rqs-15` and merged into the integration branch in 410ce4e6aaf3b296409c97f317bbd99087941410 (fast-forward).
  Open: the check reads per-Request rows (daily totals keep no Budget). A sync running across UTC midnight is recorded per Request but charged by the ledger on the day it finished, so busy midnights may warn on small mismatches; raised at the code review.
