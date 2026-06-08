# ADR-003: Hybrid Sync

**Status:** Accepted

**Decision:** Read-through cache with API-first writes.

1. `repository.ts` writes to API, then updates IndexedDB cache on success.
2. Reads check cache if `updated_at` matches server etag/timestamp; else refetch.
3. Settings/network config: server authoritative (Phase 3); UI overrides for proxies only.
4. No offline write queue in v1 (deferred).
