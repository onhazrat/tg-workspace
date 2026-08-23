# 11: Per-Channel claim, coalescing, mutual exclusion

**What to build:** Two people syncing the same Channel at once cannot corrupt its history cursors, and the second request rides the first rather than repeating the work.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Only one sync per Channel runs at a time, enforced outside process memory
- [ ] A request finding one in flight waits for it, reports its result, and is not charged
- [ ] The scheduling deadline advances on completion only; the in-flight claim is a separate field that expires on its own
- [ ] A crashed worker's Channel is picked up again without manual intervention
- [ ] A guard proves concurrent syncs do not interleave cursor writes
