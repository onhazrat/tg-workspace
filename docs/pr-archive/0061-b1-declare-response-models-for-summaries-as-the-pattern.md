# #61 ✅ B1: declare response models for summaries, as the pattern

**State:** merged 2026-07-31 · **Branch:** `b1-response-models-summaries` into `main` · **Diff:** +653 / -61 across 9 files · **Opened:** 2026-07-31

---

Unit `B1` from `docs/architecture-simplification-plan.md` — the first family converted, and the reference for the remaining five.

## Why

The audit's highest-leverage finding: only **26 of 129** operations declare a typed response. The other 103 return `dict[str, Any]` → `{"additionalProperties": true}` in OpenAPI → `Record<string, unknown>` in TypeScript. That is *why* the frontend hand-maintains 24 domain interfaces mirroring `models_tg.py` with nothing keeping them in step — renaming a column is a silent, type-clean frontend break.

## What

`summaries` turned out to be **4 endpoints**, not the 10 the plan estimated.

- `app/schemas/summaries.py` — `SummaryResponse`, `SummaryListItemResponse`, `SummaryUpsertRequest`
- `app/schemas/common.py` — `StatusResponse`, extracted immediately because *every* family answers a delete with `{"status": "deleted"}`, and the generated client would otherwise grow a near-identical anonymous object per endpoint

**Typed responses: 26/129 → 30/129.** All four summaries operations now carry a real `$ref`.

## The subtlety worth carrying forward

A summary is fixed columns **plus an open `extra` JSON blob** of UI flags that come and go (`isStarred`, `autoPublish`, `note`, …). The models declare only the always-present columns and use `ConfigDict(extra="allow")` for the rest.

Declaring a *conditional* key would be **actively wrong**. `promptExcerpt` exists only when the summary has prompt text; declaring it would serialise `"promptExcerpt": null` wherever it's absent today — silently changing the wire format for every summary without a prompt. So conditional keys are documented in the model docstring rather than declared.

The result: payload stays **byte-identical**, operation still gains a real `$ref`.

`channels`, `posts` and `tag-runs` all merge an `extra` column and will need the same call. This is now written into `CLAUDE.md` as the convention — the plan flags that as the deliverable without which the whole thing decays.

## Verification

| Check | Result |
|---|---|
| backend suite | **733 passed / 1 skipped** — baseline match |
| `test_summaries_projection.py` (264 LOC) | passes **unchanged** |
| mypy strict | clean, 106 files |
| ruff check / format | clean |
| frontend suite | **686 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean against regenerated client |
| pre-commit incl. "Generate Frontend SDK" | all pass |

The projection test passing **unchanged** is the real evidence here: it's the wire-compatibility guard, so not having to touch it is what proves the payload didn't move.

## Two environment notes (recorded in the plan for later units)

- `backend/scripts/lint.sh` calls bare `mypy`, so it only works with the venv already on `PATH` — use `uv run mypy app` / `uv run ruff check app`.
- A standalone `uv run ty check` reports **31 pre-existing** diagnostics from an environment-resolution problem. **None are in application code** and none touch these files; the pre-commit `ty` hook passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
