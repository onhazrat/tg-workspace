# ADR-009: Server-Authoritative Data

**Status:** Accepted (2026-08-01)
**Supersedes:** [ADR-003 (Hybrid Sync)](./ADR-003-hybrid-sync.md), and Decisions
[#4 (transition writes)](./DECISIONS.md) and [#5 (offline mode)](./DECISIONS.md).

**Decision:** PostgreSQL is the single source of truth. TanStack Query is the only client-side
cache. There is no IndexedDB mirror, no read-through repository, and no offline browsing.

---

## Context

ADR-003 was the right call for its moment. The app began as a standalone browser application
that held everything in IndexedDB, and a read-through cache with API-first writes was how the
FastAPI backend became authoritative **without a flag-day rewrite**. It worked: PostgreSQL is
authoritative today.

Two things have since changed, and together they invert the trade-off.

**1. The offline promise is already only partially kept.** The July 2026 remediation
(`docs/architecture-remediation-plan.md`) moved the post feed to server-side pagination, because
loading whole date ranges into the browser was driving backend workers to 3.09 GB RSS. That fix
was necessary and is not being reverted. But it means the application's *primary view* now
requires the API. With the backend down, the feed renders nothing — while the machinery that
exists to serve cached data keeps running for every other screen.

**2. A per-browser mirror becomes a liability under multi-user.** The roadmap is to go
multi-user, keeping corpus-level artefacts user-agnostic and scoping at read time. A cache that
outlives the session that was entitled to fill it is exactly the wrong shape for that: cached
rows have no user scope, and clearing them correctly on identity change is a problem we would
have to solve for no benefit.

Meanwhile the cost is concrete and measured (`docs/architecture-entropy-audit.md` §3):

| Cost | Measure |
|---|---|
| The mirror itself | `lib/cache.ts` 1,226 LOC + `lib/repository.ts` 955 + `workers/dbWorker.ts` 229 |
| Ways a component fetches data | **7** |
| Independent staleness systems | **3** — react-query `staleTime`, repository `singleFlight`+etags, IndexedDB retention |

Three caches and seven paths is not a design anyone would choose; it is the residue of a
migration that added a better path without removing the old one.

## Decision

1. **PostgreSQL is authoritative.** The browser holds no durable mirror of server rows.
2. **TanStack Query is the only client cache.** One staleness model (`staleTime`), one request
   deduplication mechanism, one invalidation story. `singleFlight` and the `syncMeta` etag
   tracking are removed as redundant.
3. **Writes go to the API and fail loudly.** No IndexedDB write-fallback, no
   "saved locally only" toast. A failed write surfaces as an error the operator can act on.
4. **No offline browsing.** When the API is unreachable the app reports it and disables the
   affected surfaces. This is a real, accepted capability loss.
5. **Server state never lives in React context.** Contexts hold UI state only.

## Consequences

**Accepted losses.** Read-only browsing of previously-fetched data while the backend is down is
gone. For a self-hosted, single-operator deployment where the backend and browser almost always
share a machine or a LAN, this is a modest loss — and it is already the reality on the feed.

**Migration hazard — one-way door.** `lib/cache.ts` may still hold bot credentials for an
operator who has not logged in since the Decision #2 token migration. Deleting the IndexedDB
layer therefore ships **at least one release after** the last read path is removed, and must be
called out in release notes. Sequenced as units A1 → A3 → A4 in
`docs/architecture-simplification-plan.md`.

**What ADR-003 got right and this keeps.** Server-authoritative settings and network config
(ADR-003 §3) are unchanged. The API-first *write* direction is unchanged — only the fallback
branch is removed.

**Not a licence to fetch unboundedly.** Every guarantee from
`architecture-remediation-plan.md` §12 still holds: endpoints stay paginated, aggregations stay
in SQL. Removing the client cache must not become a reason to re-fetch more.

## Alternatives considered

**Keep the hybrid, make it one honest layer** — put IndexedDB *behind* TanStack Query as a
persister rather than beside it as a parallel repository. This preserves offline browsing and
removes the stacked-staleness problem, but keeps the mirror, keeps the multi-user hazard, and
saves far less code. Rejected because the offline capability it preserves is one the feed no
longer offers anyway.

**Freeze `repository.ts` and let it decay** — forbid new callers, migrate opportunistically.
Lowest risk, but leaves two architectures in the tree indefinitely, which is the entropy this
work exists to remove. Rejected.
