# #71 ♻️ D1+D2: serve all five log kinds from one generic resource

**State:** merged 2026-08-01 · **Branch:** `d1-generic-log-resource` into `main` · **Diff:** +441 / -800 across 17 files · **Opened:** 2026-08-01

---

Workstream `D` from `docs/architecture-simplification-plan.md`, shipped as one unit.

## What

`GET` / `POST /data/logs/{log_type}` replace **ten** per-type endpoints.

| | before | after |
|---|---|---|
| `routes/data/logs.py` | 202 LOC | **147** |
| `/data` endpoints | 73 | **65** |

- `services/logs.py` — `LOG_LISTERS` registry + `list_logs(session, log_type, …)`
- `schemas/logs.py` — the `LogEntryResponse` union
- `api/data.ts` — ten functions → `listLogs<T>(type)` / `createLogs<T>(type, logs)`, with the five named helpers kept as one-line typed sugar

## Why one unit, not two

D1's deprecated aliases existed so the frontend could migrate independently. This repo has exactly one frontend and it's migrated in the same change — carrying ten deprecated paths across a release would be ceremony, not safety.

**The equivalence tests ran green against both the aliases and the generic route before the aliases were deleted.** That's what licensed deleting them.

## The five tables stay

A publish log records a destination; a network log records a proxy. Flattening them into one table of mostly-null columns would be a *worse* database. **The genericity is in the handling, not the storage.**

## `LogEntryResponse` is a plain union, not a discriminated one

The five payloads share no tag field, and inventing one would change the wire format of all five to serve the type system. The route already knows `log_type` from the path, so it validates with the exact model and the union only *describes* the result. Pydantic still emits it as a named component, so the endpoint stays `$ref`-typed.

## Deliberately not done — and why

The plan also asked for "five `DataContext` fields → one record". Those fields feed through `repository.ts` into the **IndexedDB cache that A3/A4 delete outright**. Collapsing them now means editing 26 call sites across 3 components to build something A3 removes.

**Deferred to A3**, where those fields are being reworked anyway. Until then the plan's "~30 files → ~3" payoff is only partly realised — I'd rather say that than claim it.

## On the typed-response count

**89/129 → 81/121.** Not a regression: ten typed alias endpoints deleted against two typed ones added. Fewer endpoints, same coverage.

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **784 passed / 2 skipped** (+19 new) |
| mypy strict | clean |
| ruff check / format | clean |
| frontend suite | **686 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean |
| mutation: `llm` → `EmbeddingLogResponse` | **3 tests fail** |

`test_route_inventory.py`'s count assertion fired on the +2 and again on the −10 — exactly what it's for.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
