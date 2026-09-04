# #73 ♻️ G3: collapse the re-derived settings binding onto the catalog

**State:** merged 2026-08-01 · **Branch:** `g3-settings-binding` into `main` · **Diff:** +208 / -87 across 3 files · **Opened:** 2026-08-01

---

Workstream `G3` from `docs/architecture-simplification-plan.md`.

## The premise had already half-happened

`settings-schema.ts` was **already** driven by `SETTINGS_CATALOG` — the fold the plan describes was largely done before this programme started. What remained was exactly what audit §E5 named: the command layer **re-deriving** setters and clamping independently of the catalog.

## What

**569 → 538 LOC**, but the size isn't the point:

- `booleanSetter` / `numberSetter` / `stringSetter` → one generic **`catalogSetter<T>`**. The three were byte-identical apart from a cast applied to a value they never inspect.
- `clampInt` / `clampFloat` → one **`parseAgainstControl(value, control)`**, taking bounds from the catalog control rather than re-deriving them with `control.min ?? 0` / `control.max ?? 1`.
- Deprecated `BOOLEAN_SETTINGS` / `NUMERIC_EDITOR_DEFS` exports deleted, their two tests rewritten to assert against the **built commands** — a test reading a parallel list could pass while the palette itself was missing the command.

**Those `??` fallbacks were dead code.** All 12 number controls declare `min`, and the single `step: "any"` control declares both bounds. Nothing changed behaviourally — verified by enumerating the catalog, not assumed.

## The real find: the binding had no tests at all

Every existing test asserted a command's **shape** — id, label, badge — and none of them ever *ran* one. Breaking `catalogSetter`'s name derivation left **all 90 passing**. This refactor started with no safety net.

Eight new tests drive commands through a spying settings proxy:

| Mutation | Before | After |
|---|---|---|
| break setter name derivation | **0 fail** | **7 fail** |
| remove the max clamp | — | **1 fail** |
| stop inverting on toggle | — | **1 fail** |

## Verification

| Check | Result |
|---|---|
| frontend suite | **695 pass / 0 fail** (12 consecutive runs) |
| `tsc -p tsconfig.build.json` | clean |
| biome | clean |

> **Known rare flake, unrelated.** `mirror-hydration.test.ts` failed twice in ~20 full-suite runs across this programme, always `QuotaExceededError` from its localStorage-quota simulation — happy-dom registers `localStorage` globally (T1), so quota state is shared across files and the failure is order-dependent. It did not reproduce in 12 consecutive runs. Pre-existing; recorded in the plan rather than papered over.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
