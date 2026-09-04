# #55 📝 Audit architecture entropy and plan the simplification

**State:** merged 2026-07-31 · **Branch:** `worktree-architecture-entropy-plan` into `main` · **Diff:** +990 / -0 across 3 files · **Opened:** 2026-07-31

---

Analysis and planning only — **no code changed**, two new documents plus index entries.

## What this is

A measured audit of code and architecture entropy, and the refactor backlog derived from it. Distinct from the prior investigations: `architecture-remediation-plan.md` optimised for **performance** (complete, 3.09 GB → 0.89 GB), `discover-probe-queue-plan.md` §5 tracks **robustness**. This one is about **comprehensibility and maintainability**.

## The central finding

The remediation plan succeeded by adding a server-first data path *next to* the original browser-app path rather than replacing it. Both are live over the same data:

- **7 distinct ways** a component obtains server data (contexts 27, `@/api` 15, `@/client` 13, `lib/repository` 13, `useQuery` 10, raw IndexedDB 2, `services/*` 2)
- **3 stacked, mutually-unaware staleness systems** (react-query `staleTime`, repository `singleFlight` + etags, IndexedDB + a 6-hourly pruner)
- Post reads **split by consumer**: the feed is server-paged, but summary/AI prompt assembly, palette search and export still pull whole date ranges into the browser

The IndexedDB layer (2,410 LOC) pays its full cost for an offline promise it no longer delivers — the main feed is server-only, so with the API down the primary view is empty.

## Highest-leverage item

Only **26 of 129** API operations declare a typed response; 103 return `dict[str, Any]`. In OpenAPI that is `{"additionalProperties": true}`, in TS `Record<string, unknown>` — so the frontend hand-maintains **24 domain interfaces mirroring `models_tg.py` with no compiler-enforced link**. Renaming a column is a silent, type-clean frontend break.

## Research answer: generated clients codebase-wide?

**Yes as a destination, no as a next step — and codegen is not the change that matters.**

ADR-006 blames SSE, but SSE explains only ~8 of the 50 endpoints the hand-written client covers. The real blocker is the untyped responses above. Adopting `DataService` today would swap 50 precise hand-written signatures for 103 untyped ones — strictly worse. Declare response models first; then one generated contract subsumes the hand-written types, the `types.ts` mirrors, and the manual discipline of keeping them in step. Especially valuable here, where CI is billing-blocked and `tsc` is the closest thing to a contract test.

Also found: the generated client is **7,660 LOC of which 7 of 10 services are never imported**, `schemas.gen.ts` (2,986 LOC) is imported by nothing, `asClass: true` defeats tree-shaking, and `legacy/axios` means the app ships **both axios and fetch**.

## Correction absorbed from the prior survey

`discover-probe-queue-plan.md` §5 P3 flagged something that materially changed this plan: there is **no `@testing-library`/`renderHook` in the repo at all** — 0 of 9 contexts and 2 of 32 hooks are tested. The plan originally leaned on tests as the safety net for exactly those files. A testing seam is now a **prerequisite workstream (T) gating the context refactors**, not an afterthought.

That document's robustness backlog stays out of scope and tracked there — with the note that its **P0 (unrecoverable `bulk_follow` job state) outranks everything in this plan**. An unrecoverable job is worse than a messy one.

## Decisions recorded up front

| Decision | Consequence |
|---|---|
| Retire the IndexedDB hybrid | Supersedes ADR-003 and Decisions #4/#5. No offline browsing. |
| Incremental, independently shippable | No phase gates; ~30 units, each safe to merge alone |
| Prepare multi-user seams, implement nothing | Avoids refactoring the same code twice |
| Template residue (`items`, `legacy.py`) | **Still open** — audit §6 provides the input |

## Scope discipline

Audit §5 explicitly marks the load-bearing walls that must **not** be "simplified": backend thin-routes/fat-services layering, the AI provider registry, the parser modules, `lib/settings/schema.ts`, `queryKeys`, and the boundedness guarantees from the remediation plan. Plan §5 lists what is deliberately not being done and why.

## Verification

No code changed, so there is nothing to test — but every number in both documents was produced by running a command, and the re-runnable metric scripts in plan §6 were executed and corrected (the typed-response one-liner was silently reporting 0/129 due to `$ref` shell escaping; it is now a heredoc and reports 26/129).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
