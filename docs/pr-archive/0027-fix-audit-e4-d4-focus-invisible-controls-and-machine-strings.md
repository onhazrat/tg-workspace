# #27 ♿ Fix audit E4 + D4: focus-invisible controls and machine strings

**State:** merged 2026-07-27 · **Branch:** `fix/audit-batch0-a11y-copy` into `main` · **Diff:** +439 / -12 across 13 files · **Opened:** 2026-07-27

---

Batch 0 was meant to be a browser pass over the 12 findings the re-verification filed as `RUNTIME`. **Six of them turned out not to need a browser at all** — they were filed that way because the audit recorded a symptom rather than a mechanism, and the mechanism was in the source.

Two are fixed here. Two more (C8, C10) are now confirmed and located for their own batches. Two (C4, D3) were confirmed on staging before the Chrome extension disconnected.

## E4 was filed as a preference and is an accessibility defect

The audit called it "hover-only card actions" and pointed at `ChannelCard` and `PostCard`. Those two are the ones that are **already correct** — both pair `group-hover:` with `group-focus-within:`. Seven other sites do not:

| Site | Control |
|---|---|
| `ChannelCard.tsx` | tag removal |
| `HistoryView.tsx` | star |
| `ChatView.tsx` | copy message |
| `TableSizesPanel.tsx` | clear table |
| `BotCredentialsPanel.tsx` | validate token |
| `DestinationsPanel.tsx` | verify destination |
| `Items/columns.tsx` | copy id |

Each is a real `<button>`, so it stays in the tab order while rendered at `opacity: 0`. A keyboard user tabs onto it and the focus ring vanishes — the control is reachable and invisible at the same time. The correct form already existed two files away, which is what makes this an invariant rather than a style opinion.

Fixed in both shapes the code uses:
- `group-focus-within:opacity-100` where `opacity-0` sits on a wrapper around the buttons
- `focus-visible:opacity-100` where it sits on the button itself

**Not addressed, needs a product call** (tracked separately): there is no `@media (hover)` or `pointer: coarse` fallback anywhere in the app, so on touch these controls still depend on a hover that never fires. Focus does not rescue that case.

## D4 — stale file pointer, and a precise cause for the date half

The code moved from `DiscoverView.tsx` to `components/discover/DiscoverScopeCard.tsx` (`:45-48`, `:57-61`). The defect is real.

The card called `formatDateToLocalISO`, which exists to produce `YYYY-MM-DDTHH:mm` because that is the only value `<input type="datetime-local">` accepts. Right helper for a form field, wrong one for a sentence — hence `Date range: 2026-07-24T23:54 – 2026-07-25T00:24`.

New `lib/format-date-range.ts` handles prose and collapses the day when a range stays inside it. Locale is a parameter so output is assertable rather than machine-dependent. The input formatter is now pinned by a test, so "humanising" it later cannot silently break every date picker in the app.

`0 fwd · 0 men · 0 link` now reads `0 forwards · 0 mentions · 0 links` via the existing `countOf` helper.

## Regression coverage

- **`css-invariants.test.ts`** gains a focus-reveal sweep over every `.tsx`, with a documented allowlist for the 4 genuinely decorative hover-reveals. Verified by reintroducing the `HistoryView` defect: the sweep fails and names the exact file and class list.
- **`format-date-range.test.ts`** (7) — asserts the output never contains `T` or `\d{4}-\d{2}-\d{2}`, and that the locale parameter actually changes rendering rather than being decorative.
- **`app-copy.test.ts`** gains 2 sweeps — signal abbreviations, and `formatDateToLocalISO`-in-prose.

The last of those **found two sites I had not**: `LogFilterBar.tsx:35` and `SummaryView.tsx:605`. Both are false positives — one feeds an input `max=` through a variable, the other builds a download filename — and both discard the time with `.split("T")[0]`, so no machine timestamp reaches a user. The predicate was narrowed to match the real invariant rather than suppressing the two sites, and a guard-the-guard test pins that the narrowing still catches the original defect.

## Still needs a browser

A2 (transition ghosting), C5 (Posts horizontal space at 1440px), E3 (chip select affordance), E5 (onboarding tour), E6 (command palette), plus the audit's §6 gaps: mobile/responsive, light theme beyond Channels, and the six never-reviewed Settings sections.

## Verification

biome clean · `tsc --noEmit` clean · **585 unit tests, 0 fail** (was 571) · e2e run against a freshly rebuilt backend.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
