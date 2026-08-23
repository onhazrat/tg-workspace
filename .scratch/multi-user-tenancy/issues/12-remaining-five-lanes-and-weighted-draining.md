# 12: Remaining five lanes and weighted draining

**What to build:** All six queues exist. Normal-priority work always drains before best-effort, and a steady trickle of manual work cannot starve automatic sync.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Six lanes exist: automatic, manual bulk, manual single, each normal and best-effort
- [ ] Draining is strict between tiers and weighted within one, favouring single, then bulk, then automatic
- [ ] Messages are enqueued interleaved across Users
- [ ] An Admin can pause or drain a single lane
