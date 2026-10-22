# RQS-13: Private handles

**What to build:** A probe tells a private handle from a missing one, the Directory keeps the difference, and a private handle is never counted as Wasted. Spec: "Outcome".

**Blocked by:** RQS-12

**Status:** ready-for-agent

- [ ] The probe path parses the soft-block page before raising, and a private Channel gets its own Directory status.
- [ ] A probe of a private handle is Useful when it changes the entry and Idle when the entry already said private; never Wasted.
- [ ] Existing Directory filters and counts treat the new status as they treated unavailable unless the Directory's tests say otherwise; nothing that read unavailable silently drops private handles.
- [ ] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
