# RQS-13: Private handles

**What to build:** A probe tells a private handle from a missing one, the Directory keeps the difference, and a private handle is never counted as Wasted. Spec: "Outcome".

**Blocked by:** RQS-12

**Status:** done

- [x] The probe path parses the soft-block page before raising, and a private Channel gets its own Directory status.
- [x] A probe of a private handle is Useful when it changes the entry and Idle when the entry already said private; never Wasted.
- [x] Existing Directory filters and counts treat the new status as they treated unavailable unless the Directory's tests say otherwise; nothing that read unavailable silently drops private handles.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23 (lead): RQS-12 files every probe soft block as `Cause.MISSING_HANDLE` via `page(METADATA, soft_block=...)` in `_probe_one`. Parse the page before raising and send a private handle down the answered path; a new private status then counts as a change through `_PROBE_WATCHED`.
- 2026-10-23: implemented on `claude/rqs-13` and merged into the integration branch in bdca814b46af9e5c5b1a9bd128d916c6f4ac9489 (fast-forward). A handle check of a private Channel is now Idle, not Wasted.
  Open: a private entry's subscriber count stays null (it shows only in `tgme_page_extra` text, not parsed).
