# 09: PGMQ install and the first lane end to end

**What to build:** A manual single-Channel sync travels through a real durable queue instead of an in-process call, and the person triggering it sees the same result as before.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The queue is installed from a migration, needing no image change and no superuser privilege
- [ ] One lane exists and a manual single sync is enqueued and consumed through it
- [ ] Progress still reaches the browser unchanged
- [ ] The visibility timeout is set from the expected worst case, with redelivery capped and exhausted messages archived
