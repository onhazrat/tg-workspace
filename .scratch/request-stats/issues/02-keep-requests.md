# RQS-02: Keep Requests a week and hourly totals a month

**What to build:** Per-Request rows are kept for `REQUEST_RECORD_DAYS` (7) and hourly totals for `REQUEST_HOURLY_DAYS` (30); daily totals are kept forever. A deployment can change both spans in its environment. Spec: "Keeping".

**Blocked by:** RQS-01

**Status:** ready-for-agent

- [x] Both variables are in settings and `.env.example`, defaulting to 7 and 30.
- [x] Startup refuses an hourly span shorter than the record span, with a message naming both.
- [x] The existing hourly retention job prunes per-Request rows and hourly totals past their spans in batched deletes; daily totals are never pruned.
- [x] The retention inventories declare the two spans for the new tables.
- [x] Tests run the retention job with a moved clock and read what is left through the API.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
