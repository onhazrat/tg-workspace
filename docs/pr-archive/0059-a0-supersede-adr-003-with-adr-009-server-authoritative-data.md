# #59 📝 A0: supersede ADR-003 with ADR-009, server-authoritative data

**State:** merged 2026-07-31 · **Branch:** `a0-supersede-adr003` into `main` · **Diff:** +134 / -14 across 6 files · **Opened:** 2026-07-31

---

Unit `A0` from `docs/architecture-simplification-plan.md`. **Docs only — no code touched.**

## Why this lands first

Workstream A removes the IndexedDB mirror. It cannot proceed while ADR-003 and Decisions #4/#5 still *mandate* that mirror — so this lands first, and later PRs delete code rather than relitigate whether they may.

## The decision

**ADR-009: Server-Authoritative Data.** PostgreSQL is the single source of truth; TanStack Query is the only client cache; writes fail loudly instead of falling back to IndexedDB; no offline browsing; server state never lives in React context.

## The reasoning, recorded rather than asserted

ADR-003 was **correct for its moment** — it is how Postgres became authoritative without a flag-day rewrite, and it worked. Two things since inverted the trade-off:

1. **The offline promise is already only partially kept.** The July remediation moved the post feed to server-side paging (necessary — it was driving workers to 3.09 GB RSS). So with the API down, the *primary view* already renders nothing, while the machinery to serve cached data keeps running for every other screen.
2. **A per-browser mirror is the wrong shape for multi-user.** Cached rows have no user scope, and a cache that outlives the session entitled to fill it is a problem we'd have to solve for no benefit.

Against that, the measured cost: **2,410 LOC**, **7** data-access paths, **3** independent staleness systems.

Both alternatives are recorded with why they lost — IndexedDB-as-persister behind react-query (keeps the mirror and the multi-user hazard, saves far less, preserves an offline capability the feed no longer offers) and freeze-and-decay (two architectures in the tree indefinitely).

The **A4 one-way door** is called out explicitly: `cache.ts` may still hold bot credentials for an operator who hasn't logged in since the Decision #2 token migration, so deletion ships at least one release after the last read path goes.

## Scope discipline

| Document | Treatment |
|---|---|
| `ADR-003` | Superseded — text kept, and what *survives* named (API-first writes, server-authoritative settings) |
| `DECISIONS.md` #4, #5 | Annotated in place, in the summary table, and in the ADR-alignment table |
| `migration/README.md` | ADR index updated — otherwise readers land on a superseded ADR with no signpost |
| `IMPLEMENTATION-PLAN.md` | Principle 1 still read *"IndexedDB is a read-through cache"* as standing. It's a completed historical doc, so it gets a forward pointer, **not** a rewrite |
| `INVENTORY.md`, `TARGET-ARCHITECTURE.md`, `REMEDIATION-PLAN.md`, `SECRETS-MATRIX.md` | **Deliberately untouched** — historical records of the migration as executed |

## Verification

No code touched. All **93 relative markdown links** across the eight affected files resolve (checked programmatically, not by eye).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
