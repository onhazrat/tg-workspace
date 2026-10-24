# ADR-003: Hybrid Sync

**Status:** ⚠️ **Superseded (2026-08-01) by
[ADR-009: Server-Authoritative Data](./ADR-009-server-authoritative-data.md).**

This ADR did its job — it is how PostgreSQL became authoritative without a flag-day rewrite.
It is superseded because the post feed is now server-paged (so offline browsing of the primary
view is already gone) and because a per-browser mirror is the wrong shape for the multi-user
roadmap. The API-first *write* direction and server-authoritative settings survive in ADR-009;
the IndexedDB mirror, the read-through cache, and the write-fallback do not. The text below is
kept as written, for the historical record.

**Decision:** Read-through cache with API-first writes.

1. `repository.ts` writes to API, then updates IndexedDB cache on success.
2. Reads check cache if `updated_at` matches server etag/timestamp; else refetch.
3. Settings/network config: server authoritative (Phase 3); UI overrides for proxies only.
4. No offline write queue in v1 (deferred).
