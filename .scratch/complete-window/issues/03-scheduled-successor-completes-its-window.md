# CW-03: The scheduled successor completes its window

**What to build:** A scheduled successor makes its window Complete when it can,
unattended, and says what it lacked when it cannot. It no longer skips its
sync because another sync job is running anywhere on the deployment: it checks,
syncs every Incomplete Channel it can repair, waits up to 5 minutes, checks
again, freezes the record like a manual action, and auto-publishes. When
metadata is sent, one line tells subscribers what the post lacked.

Spec: `.scratch/complete-window/spec.md` (The scheduler). ADR-043. The
prototype does not cover this.

**Blocked by:** CW-02.

**Status:** ready-for-agent

- [ ] The "any sync job active, skip" shortcut is gone from the successor's
  pre-sync.
- [ ] It joins a sync already in flight for a Channel, and queues another
  behind one that read its head before E; it walks back to the Start when the
  start or continuity test fails.
- [ ] After 5 minutes it stops waiting, re-checks, and freezes the record with
  unfinished Channels timed out; otherwise with choice synced.
- [ ] The metadata line reads "~40 Posts unproven (2%): @a, @b +3", naming only
  Channels that are not Behind; omitted when only Behind Channels remain or the
  window is Complete. The prompt never mentions any of it.
- [ ] Tests (the scheduler's job, time injected): runs while another sync job is
  active; joins an in-flight sync; queues behind a stale head read; times out
  and records it; the metadata line's three cases.
