# #66 ✅ B4: declare response models for the discover family

**State:** merged 2026-08-01 · **Branch:** `b4-response-models-discover` into `main` · **Diff:** +2026 / -130 across 8 files · **Opened:** 2026-08-01

---

Unit `B4` from `docs/architecture-simplification-plan.md` — the fourth family, twelve endpoints.

**Typed responses: 42/129 → 53/129.**

## What

`app/schemas/discover.py` — sixteen models, all **closed**. Nothing in the Discover family merges an open `extra` blob the way `Summary` and `Channel` do.

This is the first family with real nesting: a candidate carries per-signal counts, a per-carrier breakdown, a sample-post pointer and an optional probe verdict. `dict[str, Any]` was erasing four levels of structure at once, all of which the frontend hand-maintains.

The two inline `BaseModel` request classes in the route module (`DiscoverIgnoreRequest`, `DiscoverProbeRequest`) moved into the schema module, per the convention in `CLAUDE.md`.

## Two models per shape, not one optional field

`DiscoverCandidateResponse` is what `compute_discover_candidates` produces. `ReportCandidateResponse` subclasses it and adds `probe` — the one key a *saved* report resolves at read time.

They are separate because **`POST /discover/candidates` does not emit that key at all**. A single shared model with `probe: X | None = None` would have started sending `"probe": null` from the stateless aggregate — the same rule that keeps conditional keys out of `SummaryResponse`. `DiscoverReportResponse` / `DiscoverReportListItemResponse` split for the same reason: the list projection deliberately ships `candidateCount` instead of the corpus-sized `candidates` array.

## Declaring a stored blob was safe here — and B3 said to check first

B3 concluded that declaring a nested model is only safe when the stored shape is complete. `report_to_camel` reads `candidates` back out of a JSON column, so this is exactly that case. It holds here: `_to_candidate` is the single writer, has had one implementation since it was introduced, and `create_report` is the only constructor of a `DiscoverReport`. Verified before declaring, not assumed.

## A bug the modelling surfaced

`requeue_probes` returns `list[str]`, not a count — the first draft of `DiscoverProbeRecheckResponse` declared `requeued: int`. The route ships the handles because the UI needs to know *which* rows to repaint as pending.

## New: API-level coverage for the family

`tests/api/test_discover_projection.py`, 15 tests. The Discover services are covered well under `tests/services/`, but those call the service functions directly — **response models sit at the HTTP boundary**, so a model that truncates keys or adds `null`s passes every one of them. Before this, the only API-level Discover test was the probe queue.

Mutation-tested rather than trusted:

| Mutation | Result |
|---|---|
| merge `probe` into the base candidate model | **2 tests fail** |
| drop `seenInCount` (silent truncation) | **3 tests fail** |

## Two bookkeeping corrections to the metric

Both recorded in the plan:

1. **The pre-B4 baseline is 42/129, not the 43 recorded when B3 landed.** Re-measuring `origin/main` with the §6 script gives 42. Use that script, not an ad-hoc one — a script that treats `anyOf` differently shifts the denominator too (an ad-hoc count here read 128 operations, not 129).
2. **The metric has a second blind spot.** It matches `$ref` and `items.$ref` only, so an optional response (`-> Model | None`) renders as `anyOf: [{$ref}, {"type": "null"}]` and is not counted. `GET /discover/reports/latest` is the live example — it is typed, and the real figure is 54. This joins the already-noted `additionalProperties` case.

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **748 passed / 1 skipped** (733 + 15 new) |
| mypy strict | clean, 109 files |
| ruff check / format | clean |
| frontend suite | **686 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean against regenerated client |
| OpenAPI diff | 11 operations gained a `$ref`, **0 lost** |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
