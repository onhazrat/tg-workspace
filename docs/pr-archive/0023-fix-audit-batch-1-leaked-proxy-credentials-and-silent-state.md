# #23 🔒 Fix audit Batch 1: leaked proxy credentials and silent state corruption

**State:** merged 2026-07-26 · **Branch:** `ui-ux-audit-fixes` into `main` · **Diff:** +654 / -66 across 14 files · **Opened:** 2026-07-26

---

Batch 1 of the staging UI/UX audit — the findings where the app either **leaks a secret** or **silently corrupts user state**. Everything else is deferred.

## Re-verification came first

`docs/staging-ui-ux-audit.md` was written a week ago at `036be65`; 19 commits have landed since. I re-traced all 37 findings against `acdf1ca` before writing any code. Full results in the new `docs/staging-ui-ux-audit-verification.md`:

**1 fixed · 4 partial · 20 broken · 12 need a browser session**

Seven findings needed amending — four were overstated or already fixed, and **three had the wrong root cause**, which would have sent the fix at the wrong file. Two examples that matter for later batches:

- **A4** blames `dir="auto"` inheritance. Only two files use `dir="auto"` and both are correct. The real cause is `SummaryView.tsx:335` putting an explicit `dir` around the *whole report card* — AI body and English chrome together.
- **A7** says the title needs `truncate`. It already has it. The rule is inert because the same `<h4>` is `flex items-center`, which makes the title an anonymous flex item that `text-overflow` cannot reach.

Also resolved: B1's stated blocker ("needs an architecture decision") — `docs/migration/DECISIONS.md` §5 already rules that the IndexedDB mirror stays as the offline read cache, so no sign-off is needed.

## What this PR fixes

### A8 — proxy credentials rendered in plaintext

The audit says the masking logic "already exists in the codebase and is simply not used by the editor." It exists only in **Python** (`backend/app/services/network_settings.py:65`). There is no masking helper in `frontend/src` at all — so this is a port, not a reuse. New `lib/network/maskProxyUrl.ts`, verified byte-identical to the backend on 10 shared inputs.

The audit named one leaking site. There were **three**: the editor, the per-proxy overrides list, and the test-results list. All three are masked.

**The masked editor is `readOnly` by design.** A masked projection must never be an input value — otherwise the next keystroke persists `***` over the real credentials. Making it read-only removes that code path entirely rather than relying on careful `onChange` handling. A **Reveal** toggle swaps in the live editable value and re-masks on blur, and only appears when the list actually contains credentials.

### A3 — enum settings accepted values that no longer exist

Filed as a hypothesis; it is provable from source. `selectedModel` used `stringSetting`, whose schema is `z.string().min(1)` — **any** non-empty string validated. A stale model id survived, restored, matched no option in the segmented control, and rendered as nothing selected.

The fallback machinery already existed (`store.ts` `safeParse` → default), so this is a declaration change, not new infrastructure. Four settings moved to a new membership-validated `oneOfSetting`. **`stringSetting` is now deleted rather than left unused**, so no future setting can skip validation the same way.

### A6 — opening a saved report overwrote your global model setting

Filed as `OBSERVED`, cause untraced. It is a real side effect at `history-selection.ts`, not a display bug: loading a record called `setSelectedModel`, rewriting the "model for the next generation" setting. The report's own model was *already* rendered from the record, so removing the mutation is the whole fix.

### A1 — Settings advertised a Danger Zone that rendered Table Sizes

Removed rather than built (your call). `?section=danger` now degrades to `commonly-used`, with a regression test. `DangerPanel` is left alone — despite the name it is the clear-table confirm dialog, not the missing section.

## Deliberately not done here

`history-selection.ts` also calls `setAiLanguage` — the same class of global mutation as A6. Unlike the model it has a job: it drives the direction and font the loaded report renders with. Fixing it properly means deriving direction from the record instead of the global, which is a change to the exact `dir` logic **A4** rewrites in Batch 2. Doing it now would mean editing `SummaryView.tsx:335` twice.

## Verification

- `biome check` clean
- `tsc -p tsconfig.build.json --noEmit` clean
- **498 unit tests** pass (up from 482 — 12 for the mask util, 4 for the new validation)
- production build succeeds
- **61/61 e2e** pass (`summarizer.spec.ts` + `settings-hub.spec.ts`, `--workers=1`, `PLAYWRIGHT_CHANNEL=chrome`)

> `settings-hub.spec.ts` now passes in full — the two duplicate-`data-testid` failures previously treated as pre-existing were fixed by `522e410`.

## ⚠️ Operator action, not code

**The staging proxy password captured in the audit is still live and must be rotated.** It is in `docs/staging-ui-ux-audit.md:245` and in git history. Masking prevents the *next* exposure, not this one.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
