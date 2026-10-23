# RQS-12: Directory probes recorded

**What to build:** Directory probes are recorded with their own outcome rule, and show as the Directory probes row. Spec: "What a Request is", "Outcome".

**Blocked by:** RQS-01

**Status:** ready-for-agent

- [x] Probe Requests carry kind probe, no Account, Uncharged, the handle probed, page type metadata.
- [x] Useful when the probe changed the Directory entry (verdict, kind, title, subscriber count) or added new sample Posts, whose count it records; Idle otherwise; a handle that doesn't exist is Wasted with cause missing handle.
- [x] The verdict writer reports whether the entry changed and how many sample Posts were new.
- [x] Totals carry probes with no Channel, shown as the Directory probes aggregate row.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
