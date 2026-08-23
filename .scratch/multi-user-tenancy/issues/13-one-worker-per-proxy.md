# 13: One worker per proxy

**What to build:** Each worker owns one proxy and holds a long-lived connection to it, so the rate any one proxy sees is predictable and capacity honestly reflects available proxies.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Worker count derives from proxy count
- [ ] A worker whose proxy is in cooldown parks until it recovers
- [ ] The shared per-proxy concurrency gate is replaced by partitioning
- [ ] The worker-count guard is updated to assert the reasons that remain, not deleted
