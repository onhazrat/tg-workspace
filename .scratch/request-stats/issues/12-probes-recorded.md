# RQS-12: Directory probes recorded

**What to build:** Directory probes are recorded with their own outcome rule, and show as the Directory probes row. Spec: "What a Request is", "Outcome".

**Blocked by:** RQS-01

**Status:** done

- [x] Probe Requests carry kind probe, no Account, Uncharged, the handle probed, page type metadata.
- [x] Useful when the probe changed the Directory entry (verdict, kind, title, subscriber count) or added new sample Posts, whose count it records; Idle otherwise; a handle that doesn't exist is Wasted with cause missing handle.
- [x] The verdict writer reports whether the entry changed and how many sample Posts were new.
- [x] Totals carry probes with no Channel, shown as the Directory probes aggregate row.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23: implemented on `claude/rqs-12` and merged into the integration branch in 1d571e11c58a558c6424b0984dca49a40d600d2c (fast-forward).
  Open: every soft block on a probe is filed as missingHandle, private handles included, because the fetch raises before the page is parsed; handed to RQS-13.
