# #24 🐛 Fix audit Batch 2: wrong information on screen

**State:** merged 2026-07-26 · **Branch:** `ui-ux-audit-batch2` into `main` · **Diff:** +1127 / -71 across 34 files · **Opened:** 2026-07-26

---

Batch 2 of the staging UI/UX audit — the findings where the app **shows the user something untrue**. Follows #23 (Batch 1: leaked credentials and silent state corruption).

Full re-verification of all 37 findings is in `docs/staging-ui-ux-audit-verification.md`.

## Regression coverage

Per request: **every fix has a test, and each guard is itself tested against the original defect** so it cannot pass vacuously. Unit tests **498 → 552**.

Two are worth calling out because they guard the whole class rather than the one line:

- **`css-invariants.test.ts`** sweeps every `.tsx` for `truncate`/`line-clamp` on a flex container — the A7 bug class. Verified to flag the original class list verbatim while ignoring `flex-1` and the fixed shapes.
- **`app-copy.test.ts`** sweeps components for "all data is stored in your browser" claims and hardcoded versions. Verified to catch all three original strings with no false positives on the replacements.

Plus `markdown` (13), `report-direction` (4), `history-selection` (4), `sync-schedule-summary` (5), `grid-count-label` (7), `tag-preview-scope` (5), `data-freshness` (5), `plural` (5).

## Three findings were described wrongly

In two cases the audit's suggested fix would have made things worse.

**C2 is not "the header cards ignore the DATA SOURCE toggle."** `repository.ts:843` `getDBStats()` **merges** server record counts over a local base, so the header showed server counts beside browser storage figures — a hybrid matching neither column of the table below. The three cards read three different sources, and the toggle governs a fourth thing (per-table size computation). Making them "obey the toggle" would have been wrong. Each card is now labelled for the source it actually reads.

**C3 is not one number rendered twice.** `selectedChannels.size` and the preview's `rows.length` count genuinely different sets — channels selected *now*, versus channels the generated suggestions *cover*. They legitimately diverge once the selection changes after a run. Deriving both from one source, as the audit suggested, would have destroyed real information. Each is now named, with a note that appears only when they diverge.

**A7's status line was never a truncation bug.** The `truncate` there works — it is a real block. The defect was content that could never fit (two full `toLocaleString()` timestamps inside 220px) beneath a tooltip that showed something else entirely. Now relative times, with the actual schedule in the tooltip.

## What changed

| ID | Fix |
|---|---|
| **A5** | Raw markdown leaked into every History preview (`**🔴 Executive Summary**`). New `lib/markdown.ts` strips syntax, clips on a word boundary, uses a real ellipsis. |
| **A4** | The audit blamed `dir="auto"` inheritance — only two files use it and both are correct. The cause was an explicit `dir` on the *whole report card*, wrapping the AI body and the English chrome together. Direction now applies to the generated body only, read from the record rather than global settings. |
| **A6** (rest) | Because direction now comes from the record, `history-selection.ts` no longer needs `setAiLanguage` either. **Opening a saved report now writes nothing global** — the `settings` key is gone from the selection context entirely. |
| **A7** | The title already had `truncate`; it was inert because the same `<h4>` is `display:flex`, making the title an anonymous flex item that `text-overflow` cannot reach. Moved onto the text's own span. |
| **C1** | "Showing 20 of 25 channels" in the grid footer — both counts were already plumbed and simply never displayed. |
| **C2** | Header cards relabelled per source; stale table sizes now flagged. |
| **C3** | Preview reads "(N channels with suggestions)"; divergence note added; `channel(s)` retired. |
| **D1** | Copy rewritten: PostgreSQL is the source of truth, IndexedDB an offline cache. The old text implied clearing your browser loses your data. |
| **D2** | Version injected from `package.json` via Vite `define`, replacing two hardcoded strings that disagreed with each other and with `package.json`. |

## Verification

- `biome check` clean · `tsc --noEmit` clean
- **552 unit tests** pass (was 498)
- production build succeeds, with the version confirmed substituted in the bundle
- **61/61 e2e** pass (`summarizer.spec.ts` + `settings-hub.spec.ts`, `--workers=1`, `PLAYWRIGHT_CHANNEL=chrome`)

> Two e2e assertions were **updated, not worked around**: they asserted the old `3 selected channel(s)` and `(3 channels)` strings that C3 deliberately changed. A new e2e assertion covers the C1 indicator.

## ⚠️ Still outstanding — operator action

**The staging proxy password captured in the audit must be rotated.** Unchanged from #23: masking prevents the next exposure, not this one.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
