# UI Polish Audit & Improvement Plan

> Created: 2026-06-25 | Updated: 2026-06-28 | Status: **Phase G complete** — all approved Phase A–G items implemented

---

## 1. Executive Summary

The TG Summarizer frontend is a deliberately dense, technical power-user tool with a strong custom design language (monochromatic `app-*` token system, all-caps/mono typography, flat minimalism). The aesthetic choices are coherent and intentional. However, a code-level audit surfaced **31 findings** ranging from critical accessibility gaps to nice-to-have polish items.

The most impactful issues are:
- Horizontal tab overflow / mobile breakage (no wrapping/scrolling on the workspace tab bar)
- Hover-only action buttons that are completely invisible to keyboard/screen reader users
- Extreme sub-12px text sizes throughout that likely fail WCAG contrast minimums
- Two competing modal systems with different keyboard trapping behaviours
- One 2,000+ line component (`SettingsView.tsx`) creating maintenance risk

All 13 product/design decisions (§5.1) have been answered. Implementation can proceed phase by phase.

---

## 2. Methodology

**What was reviewed:**
- `frontend/src/` — all 105 `.tsx` / `.ts` source files (routes, components, UI primitives, hooks, contexts, constants)
- `frontend/src/index.css` — CSS custom properties, theme tokens, `@theme` block
- `frontend/tests/summarizer.spec.ts` — Playwright E2E test expectations
- `MEMORY.md` — project decisions, architecture
- Recent plan files in `.cursor/plans/` (command palette IDEA-001/004/005/007)

**What was NOT reviewed:**
- Live running app (no dev server launched; analysis is code-only)
- Visual screenshots (unavailable without browser)
- Admin shell `/_layout/*` routes (template-originated, separate design system — out of scope)
- Auth pages `/login`, `/signup`, `/recover-password` (using standard shadcn — minor issues noted but not primary focus)

---

## 3. Current UI Inventory

### Routes & pages
| Route | Component | Design System |
|---|---|---|
| `/login` | `AuthLayout` + shadcn Form | shadcn (`--background`, `--foreground`, …) |
| `/signup` | `AuthLayout` + shadcn Form | shadcn |
| `/recover-password`, `/reset-password` | `AuthLayout` | shadcn |
| `/_tg/summarizer` | `App.tsx` + `TgProviders` | Custom `app-*` tokens |
| `/_layout/` (admin shell) | shadcn sidebar + template | shadcn |

### TG Summarizer workspace tabs
| Tab ID | Component | Key sub-views |
|---|---|---|
| `channels` | `ChannelGrid` | `ChannelCard`, `Modal` (confirm) |
| `posts` | `PostFeed` | `PostFilter`, `PostCard` |
| `summary` | `SummaryView` | `SummaryConfig`, `PasteSummaryModal` |
| `chat` | `ChatView` | `CitationHover` |
| `history` | `HistoryView` | inline filters, note editing |
| `settings` (entry via gear icon) | `SettingsHub` | `SettingsView` (2000+ lines), `BotManagement`, `DatabaseManagement`, `DiagnosticsView`, `RuntimeConfigView` |

### Key global overlays
- `CommandPalette` — shadcn `Dialog` + `cmdk` Command; opened via `Cmd+Shift+P` or header icon
- `CommandConfirmDialog` — rendered inside `CommandPalette` `DialogContent`
- `Modal.tsx` — custom animated overlay (used in `ChannelGrid` confirmation dialogs)
- Banners: offline, auto-sync paused (animated `AnimatePresence` in `App.tsx`)
- Toasts: two toaster systems — `tg-sonner.tsx` (TG app) vs `sonner.tsx` (admin/root)

---

## 4. Findings

### Severity: Critical

**C1 — Workspace tab bar overflows on mobile**
- **Location:** `App.tsx:287–317` — outer `flex gap-4` with no wrapping or scroll
- **Evidence:** 5 tabs × ~80px each + stats row + buttons on the same flex row; no `overflow-x-auto` or `flex-wrap`; the stats block is `hidden sm:flex` but the tabs themselves have no responsive treatment
- **Impact:** The entire tabs row becomes unusable on small viewports; content may be hidden or cut off
- **Suggested fix:** Add `overflow-x-auto` + `scrollbar-hide` to the tab strip, or use a `flex-wrap` container, or split the header into two rows at `sm:` breakpoint. Decision needed (Q1, Q2).

**C2 — Hover-only action buttons inaccessible to keyboard/screen reader users**
- **Location:**
  - `PostCard.tsx:188` — action bar (`Copy Link`, `Open in Telegram`, `Translate`, `Find Related`) set to `opacity-0 group-hover:opacity-100`
  - `ChannelCard.tsx:216` — hover action bar (`Freeze`, `Reset & Sync`, `Delete`) same pattern; also the external link icon on avatar (`opacity-0 group-hover:opacity-100`)
- **Evidence:** These buttons have no `tabIndex` nor any other keyboard-accessible alternative path. A keyboard user has no way to Copy Link or Delete Channel without the command palette.
- **Impact:** Fails WCAG 2.1 SC 2.1.1 (Keyboard) for these actions
- **Suggested fix:** Add `:focus-within` visibility alongside `:hover`, or include these actions in a keyboard-accessible menu/dropdown. Channel delete is already in the command palette — decide whether to keep hover as the only card-level UI path (Q7).

---

### Severity: High

**H1 — Extreme sub-12px text sizes throughout**
- **Location:** Widespread — `text-[8px]`, `text-[9px]`, `text-[10px]`, `text-[11px]` in `ChannelCard.tsx`, `PostCard.tsx`, `ChannelGrid.tsx`, `PostFilter.tsx`, `PaletteKeyboardChrome.tsx`, `App.tsx`, `HistoryView.tsx`, and many more
- **Evidence:** `text-[9px]` paired with `opacity-40` in multiple places (e.g., label text in `ChannelCard` bottom section). At 9px × 0.4 opacity on a `#e4e3e0` background the contrast ratio is well under 3:1, failing WCAG AA (which requires 4.5:1 for normal text, 3:1 for large text — and 9px is not large).
- **Impact:** Legibility issue for users; WCAG AA failure on most metadata labels
- **Suggested fix:** Establish a minimum font size floor (recommend 11px / `text-[11px]` minimum, ideally 12px for body/labels). Increase or remove heavy opacity dimming for small text. Decision needed (Q3).

**H2 — Two competing modal systems with different keyboard behavior**
- **Location:**
  - `Modal.tsx` — custom framer-motion overlay; used in `ChannelGrid.tsx` confirm dialogs (Reset & Sync, Delete Channel, Bulk Delete)
  - `Dialog` (shadcn/radix) — used in `CommandPalette.tsx`
- **Evidence:** `Modal.tsx` has no explicit `Escape` key handler (relies on backdrop click only), no `useEffect` focus trap, no `aria-modal`, no `DialogTitle` for screen readers. Radix `Dialog` handles all of this via the primitive. The two UIs diverge noticeably in animation, style (rounded vs. not), and keyboard behavior.
- **Impact:** Confirm dialogs in ChannelGrid are not keyboard-escapable or focus-trapped. Screen reader users get no modal semantics. Inconsistent user experience.
- **Suggested fix:** Replace `Modal.tsx` with shadcn `Dialog`. Style it to match the `app-*` token system. Decision needed (Q5).

**H3 — Settings entry point is ambiguous and has duplicate navigation**
- **Location:** `App.tsx:354–366` (gear icon button) vs `WORKSPACE_TABS` constant (doesn't include settings as a tab) vs `VALID_TABS` array in `summarizer.tsx:9–16` (does include `settings`) vs `SettingsHub` sidebar
- **Evidence:** Settings is accessible as a hidden gear icon on the right side of the toolbar, not as a labeled tab. Once inside `SettingsHub`, there is a second left-rail navigation with 8 sub-sections. There is also a duplicate `Settings` icon button in the tab bar area for the active `settings` state. The URL shows `?tab=settings` but the tab strip shows no `Settings` tab visually.
- **Impact:** Discoverability issue. First-time users may not see the gear icon, or may not realize the gear button toggles settings vs. always-navigates there.
- **Suggested fix:** Either (a) add Settings as a visible labeled tab in `WORKSPACE_TABS`, or (b) clarify the gear as a dedicated "Engine Room" entry point with a distinct visual treatment. Decision needed (Q4).

**H4 — Custom `Modal.tsx` lacks focus trap and ARIA modal semantics**
- **Location:** `Modal.tsx:14–56`
- **Evidence:** No `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby`, no focus trap (tab can exit the modal to behind elements). Click on backdrop closes but `Escape` key does not (no keydown handler on backdrop/modal).
- **Impact:** Keyboard users can navigate out of open modals. Screen reader users get no modal role announcement.
- **Suggested fix:** Merge with H2 (replace with Radix Dialog). If kept, add `role="dialog"`, `aria-modal`, `aria-labelledby`, and `useEffect` focus trap with Escape handler.

**H5 — `SettingsView.tsx` is 2,000+ lines (single giant component)**
- **Location:** `frontend/src/components/SettingsView.tsx` — the file handles Appearance, Scraping & Sync, AI & Models, and Network & Security sections in one monolithic component with 100+ state variables
- **Evidence:** The file renders completely different UIs for 4 different `activeSection` values. Adding a new setting requires navigating 2000 lines. The component is already noted in MEMORY.md as technical debt.
- **Impact:** Maintenance risk; very large test surface. Any re-render of a settings change re-evaluates all 100+ state computations.
- **Suggested fix:** Extract each section into its own component (`AppearanceSettings.tsx`, `SyncSettings.tsx`, `AISettings.tsx`, `NetworkSettings.tsx`). Decision needed (Q13).

---

### Severity: Medium

**M1 — Channel grid caps at 2 columns on all large screen sizes**
- **Location:** `ChannelGrid.tsx:716` — `grid-cols-1 md:grid-cols-2` with no `lg:` or `xl:` breakpoints
- **Evidence:** On a 1920px display with 40+ channels, the grid has two columns with very wide cards. A 3 or 4 column layout would show more channels without scrolling.
- **Suggested fix:** Add `lg:grid-cols-3 xl:grid-cols-4` (or let the user decide; decision Q8).

**M2 — Bulk freeze/unfreeze in ChannelGrid has no confirmation and no feedback**
- **Location:** `ChannelGrid.tsx:226–253` (`handleBulkFreeze`, `handleBulkUnfreeze`)
- **Evidence:** Both functions execute immediately on button click with no confirmation dialog (unlike the command palette which has `requiresConfirmation` for the same operations). No toast feedback on completion.
- **Impact:** A user who accidentally clicks "Freeze" on 100 selected channels has no chance to undo. Inconsistent with command palette behavior.
- **Suggested fix:** Add toast feedback on completion. Optionally add confirmation for large selections (>N channels). Decision needed (Q10).

**M3 — `CommandConfirmDialog` mixes token systems**
- **Location:** `CommandConfirmDialog.tsx:68` — `text-muted-foreground` (shadcn token) used inside the TG app's `app-*` token shell
- **Evidence:** `text-muted-foreground` resolves to `oklch(0.556 0 0)` in light and `oklch(0.708 0 0)` in dark — these are shadcn semantic tokens, not `app-ink`. Inside the palette (which renders in a shadcn `Dialog`), this works. But it creates a dependency on shadcn theme tokens in what is otherwise an `app-*`-themed component. If the shadcn palette background is ever restyled, this description text could become hard to read.
- **Suggested fix:** Use `text-app-ink/60` instead of `text-muted-foreground` for consistency with the rest of the TG shell.

**M4 — PostFilter keyword input forces uppercase styling on user input**
- **Location:** `PostFilter.tsx:248` — `uppercase tracking-widest` applied to the `<input>` for keyword search
- **Evidence:** `uppercase` CSS transform applies to the input's text content as typed. The user sees their query rendered in all caps, which can be disorienting (especially for queries with proper nouns).
- **Suggested fix:** Move `uppercase tracking-widest` to the `placeholder` only (use `placeholder:uppercase placeholder:tracking-widest`), or remove it from the input entirely.

**M5 — Auto-follow toggle uses non-standard rectangle toggle shape**
- **Location:** `ChannelCard.tsx:710–732`
- **Evidence:** The toggle is `w-10 h-5` with no `rounded-full` — it renders as a flat rectangle, unlike standard pill-shaped toggles. The thumb (`w-3.5 h-3.5`) is not rounded either. This is the only control in the app with this appearance — all other interactive elements use rounded shapes.
- **Impact:** Users may not recognise it as a toggle; visual inconsistency
- **Suggested fix:** Add `rounded-full` to the track and thumb. Decision needed (Q11).

**M6 — Statistics bar hidden entirely on mobile**
- **Location:** `App.tsx:319` — `hidden sm:flex` on the entire stats + settings button group
- **Evidence:** "Last Sync", "Active Channels", "Posts in Scope" are all operational metrics relevant when using the app. On mobile they disappear entirely.
- **Suggested fix:** Move stats to a collapsible summary bar below the tab row on mobile, or show abbreviated versions. Decision needed (Q1, Q2).

**M7 — Terminal theme applied to Diagnostics/Runtime Config may be hard to read in light mode**
- **Location:** `SettingsHub.tsx:132` — `terminal-theme text-app-ink` applied when `activeSettingsTab === "diagnostics" || "runtime-config"`
- **Evidence:** `terminal-theme` sets `--bg: #050505`, `--ink: #00ff41` (bright green). In light mode, the full SettingsHub renders with the app's normal light background until entering these tabs, then abruptly switches to dark terminal style. `text-app-ink` in terminal theme is `#00ff41` — very different from the rest of the app.
- **Impact:** Users in light mode see a jarring style switch. Some color combinations (amber/green tooltips on near-black background) may have insufficient contrast.
- **Suggested fix:** Remove `text-app-ink` override (the terminal theme already sets `--ink`). Consider always using dark terminal theme regardless of app theme, and announcing the visual switch to the user. Decision needed (Q6).

**M8 — `Modal.tsx` uses semicolons inconsistently with rest of codebase**
- **Location:** `Modal.tsx:1–56`
- **Evidence:** The file uses semicolons at end of statements (`import React from "react";`), while all other component files in the project use no-semicolon style (enforced by Biome). Biome may already flag this — check `bun run lint`.
- **Suggested fix:** Run Biome auto-fix on `Modal.tsx`, or fix manually on the next edit.

**M9 — No keyboard-accessible path to see "Copy Link" / "Open in Telegram" on PostCard**
- **Location:** `PostCard.tsx:188–270`
- **Evidence:** The only permanent (always visible) interactive element on a PostCard is the post body itself (click for related posts when embeddings enabled). The Copy Link, External Link, Translate, and Related buttons are all hover-only. (See C2 for full impact.)
- **Note:** This overlaps with C2; listed separately for action tracking.

**M10 — `SummaryView` pending state lacks visual clarity about required user action**
- **Location:** `SummaryView.tsx:346–` — `isPending` branch
- **Evidence:** When a pending summary exists, the view shows a "Pending" state with a `ClipboardPaste` button but doesn't prominently communicate that the user must paste an AI response to complete the summary. The pending banner's visual hierarchy is unclear without live verification.
- **Suggested fix:** Add a brief instructional sentence ("You generated a prompt. Paste the AI's response to complete this summary.") near the primary CTA. Decision needed (Q12).

**M11 — Channel card `Start ID` field exposed at default for all users**
- **Location:** `ChannelCard.tsx:614–662`
- **Evidence:** "Start ID" is a technical scraping parameter (the starting Telegram post ID). It's shown by default on every card in the bottom section. For casual users this is confusing jargon.
- **Suggested fix:** Gate it behind the Appearance settings toggles (like `showChannelBio`, `showChannelSubscribers` etc.) or move to an "advanced" section. Decision needed (product preference).

---

### Severity: Low

**L1 — Inline tag input has no `autoFocus`**
- **Location:** `ChannelCard.tsx:579` — `<input>` inside `{isAddingTag && ...}` block
- **Evidence:** When `isAddingTag` becomes true and the input renders, there's no `autoFocus` attribute, so the user must click the input again after clicking "Add Tag".
- **Suggested fix:** Add `autoFocus` to the tag input.

**L2 — Sync progress percentage uses potentially inverted formula**
- **Location:** `ChannelCard.tsx:196` — `Math.round((stats.maxId / stats.latestId) * 100)`
- **Evidence:** During backward sync, `latestId` is the most recent post ID (large number) and `maxId` is the oldest we've reached (small number going down). So `maxId / latestId` starts near 0 and approaches 1 as sync completes — this is correct. But if `maxId > latestId` (which can happen when a new post arrives during sync), the percentage shows > 100%, clamped at `Math.min(100, ...)` which is handled. However, the label says "Syncing X%" which could confuse users since it counts backward.
- **Suggested fix:** Consider showing "Synced X posts" count rather than a percentage, or invert: `(1 - maxId/latestId) * 100`.

**L3 — Channel name search in `ChannelGrid` is a separate input from the Add Channel input, causing layout density**
- **Location:** `ChannelGrid.tsx:361–393` — two adjacent inputs in the same row with no visual separation other than width
- **Evidence:** The Add Channel input and Search input look nearly identical. First-time users may type a search query in the Add Channel field and inadvertently add a channel.
- **Suggested fix:** Add a `Search` icon prefix to the search input (already partially done) and a stronger visual distinction (e.g., different background shade, or separate them into different rows). The search already has a slightly different placeholder but no left icon.

**L4 — `RelativeTime` component does not show absolute timestamp on hover**
- **Location:** `RelativeTime.tsx` (not read but inferred from usage)
- **Evidence:** Used in many places (e.g., ChannelCard last updated, PostCard header). Users see "2 hours ago" but can't verify the exact time without external tools.
- **Suggested fix:** Add `title={new Date(timestamp).toLocaleString()}` or a tooltip for absolute time.

**L5 — History view date filter uses raw `<input type="datetime-local">` inline**
- **Location:** `HistoryView.tsx` — the advanced filters section has `startDateFilter`/`endDateFilter` as raw datetime-local inputs
- **Evidence:** Browser native datetime pickers differ dramatically across OS/browser combinations (Chrome vs Firefox vs Safari) and do not respect the app's visual style.
- **Suggested fix:** Use the same `datetime-local` inputs already used in `PostFilter.tsx` (which have consistent custom styling), or adopt a consistent date picker component for both views.

**L6 — ChannelGrid sort controls use unstyled native `<select>` elements**
- **Location:** `ChannelGrid.tsx:533–568` — Lang filter, Sort By, Auto Sync interval all use `<select>` with `bg-transparent outline-none`
- **Evidence:** Native selects render differently across OS/browsers and don't match the app's design. Partially mitigated by `bg-transparent` styling but the dropdown itself is always native.
- **Suggested fix:** Replace with shadcn `Select` component, or accept the native behavior (it's acceptable for a power-user tool). Decision needed (Q9).

**L7 — `CommandPalette` dialog uses `bg-background` (shadcn) token not `app-card`**
- **Location:** `dialog.tsx:64` — `bg-background` in the default `DialogContent` classname
- **Evidence:** In the TG app, `--background` (shadcn) = `oklch(1 0 0)` (white in light) and `--card-bg` (custom) = `#ffffff` — currently identical, but they're tracked independently. If the `app-card` color is adjusted, the palette would not follow.
- **Suggested fix:** The `CommandPalette` usage in `CommandPalette.tsx` passes a custom `className` to `DialogContent` — check that it overrides background via `bg-app-card`. Low risk but worth aligning.

**L8 — HistoryView delete has no confirmation dialog (unlike ChannelGrid)**
- **Location:** `HistoryView.tsx:178` — `handleDeleteSummary` executes immediately on click without confirmation
- **Evidence:** Channel delete has a confirmation modal. Summary delete does not. Inconsistent destructive action pattern.
- **Suggested fix:** Add a brief toast with undo window, or a confirmation step. Decision needed (product preference).

**L9 — No skip-navigation link for keyboard users**
- **Location:** `App.tsx` / `__root.tsx`
- **Evidence:** No `<a href="#main-content">Skip to content</a>` element at page top. Keyboard users must Tab through all header controls before reaching content on each visit.
- **Suggested fix:** Add a skip nav link as first focusable element in `App.tsx`. Low effort.

---

### Severity: Nice-to-Have

**N1 — No loading skeletons on initial data load**
- The app transitions from blank to populated without skeleton placeholders. The `summarizing` spinner covers the content area but there's no initial skeleton for channel cards or post cards on first load.

**N2 — Channel grid shows no count summary ("Showing X of Y channels")**
- When filtering is active (`channelSearch`, `selectedLanguageFilter`), there's no count displayed indicating how many of the total channels are visible.

**N3 — No keyboard shortcut hints visible in the main UI**
- Besides the command palette tooltip showing `⌘⇧P`, no other keyboard shortcuts are surfaced. Power users would benefit from a keyboard shortcuts reference (accessible via e.g., `?` key or a link in the header).

**N4 — PostCard body renders raw text with `whitespace-pre-wrap` but no max-height with expand**
- Long posts expand the card indefinitely. No "Show more/Collapse" affordance for very long posts.

**N5 — `ChannelCard` gradient avatars use hardcoded Tailwind gradient stops**
- `ChannelCard.tsx:41–54` defines 6 gradient classes. These hardcoded Tailwind strings (`from-blue-400 to-blue-600`) are fine but are not part of the design token system, making them invisible to any future theming changes.

**N6 — Auth pages (`/login`, `/signup`) and TG app use different theme modes**
- The TG app defaults to dark (`THEME_DEFAULT = "dark"` in `constants.ts`). The auth pages use shadcn theme managed by `Appearance` component (separate theme context). A user who sets TG app to light mode will see the auth pages in whatever their last auth-page preference was — can be jarring on redirect.

**N7 — `SummaryView` publishes to Telegram with no character count or Telegram message limit warning**
- Telegram has a 4096 character limit per message. Long summaries could be silently truncated.

**N8 — HistoryView notes editing is inline text area with no min/max height**
- The note textarea in HistoryView has no `rows` attribute or min/max height constraint, defaulting to a single-row input that expands unpredictably.

---

## 5. Questions for Product/Design Decisions

### 5.1 Decision log (answered 2026-06-25)

| # | Question | Decision |
|---|---|---|
| Q1 | Mobile usage intent | **Desktop-only** — mobile responsive work out of scope |
| Q2 | Responsive breakpoint strategy | **N/A** (desktop-only) — C1/M6 deprioritized, not blocking |
| Q3 | Minimum font size & contrast | **Adjust per WCAG AA** — audit and fix contrast failures; raise sizes/opacity where needed |
| Q4 | Settings discoverability | **Add Settings as a labeled tab** in the workspace tab bar |
| Q5 | Modal unification | **Replace `Modal.tsx` with themed shadcn `Dialog`** |
| Q6 | Terminal theme for Diagnostics | **Keep terminal green-on-black always** for Diagnostics/Runtime Config |
| Q7 | Accessibility goal | **WCAG 2.1 AA** — fix hover-only buttons, contrast, focus traps |
| Q8 | Channel grid columns | **3 on `lg:`, 4 on `xl:`** |
| Q9 | Native select vs styled | **Replace with shadcn `Select`** |
| Q10 | Bulk freeze/unfreeze | **Always confirm** — match command palette behavior |
| Q11 | Auto-follow toggle shape | **Standard rounded-pill toggle** |
| Q12 | Pending summary UX | **Add explicit instructional text** about the paste flow |
| Q13 | `SettingsView.tsx` refactor | **Defer** — only when settings are next heavily touched |

### 5.2 Original questions (reference)

1. **Mobile usage intent** → Desktop-only
2. **Responsive breakpoint strategy** → N/A
3. **Minimum font size & contrast standard** → WCAG AA compliance
4. **Settings discoverability** → Labeled tab
5. **Modal unification** → shadcn Dialog
6. **Terminal theme for Diagnostics** → Keep always
7. **Accessibility goal** → WCAG 2.1 AA
8. **Channel grid column count** → lg:3, xl:4
9. **Native select vs styled select** → shadcn Select
10. **Bulk freeze/unfreeze confirmation** → Always confirm
11. **Auto-follow toggle shape** → Rounded pill
12. **Pending summary UX** → Add instructional text
13. **`SettingsView.tsx` refactor** → Defer

---

## 6. Proposed Phases

> **Approved** — ordered by impact and dependency. Mobile items (B1, B2) skipped per Q1.

### Phase A — Quick wins (1–2 days)
Low-risk fixes that don't depend on larger refactors:

- [x] **A1** Add `autoFocus` to inline tag input — `ChannelCard.tsx:579`
- [x] **A2** Fix `PostFilter` keyword input uppercase styling — `PostFilter.tsx:248` (move `uppercase` to placeholder)
- [x] **A3** Add `title={timestamp}` absolute tooltip to `RelativeTime` — `RelativeTime.tsx`
- [x] **A4** Fix `CommandConfirmDialog` mixed tokens — replace `text-muted-foreground` with `text-app-ink/60`
- [x] **A5** Add skip-navigation link to `App.tsx` — L9
- [x] **A6** Add "Showing X of Y channels" count to ChannelGrid filter bar — N2
- [x] **A7** Add explicit instructional text to pending summary state — `SummaryView.tsx` (Q12)
- [x] **A8** Round auto-follow toggle to standard pill shape — `ChannelCard.tsx` (Q11)

### Phase B — Layout (0.5 day)
- [x] **B1** Channel grid: `lg:grid-cols-3 xl:grid-cols-4` — `ChannelGrid.tsx:716` (Q8)
- ~~**B2** Mobile tab bar scroll~~ — **skipped** (desktop-only)
- ~~**B3** Mobile stats bar~~ — **skipped** (desktop-only)

### Phase C — Accessibility / WCAG AA (2–3 days)
- [x] **C1** Hover-only buttons: add `:focus-within` visibility or always-visible action menus — `PostCard.tsx`, `ChannelCard.tsx` (Q7)
- [x] **C2** Typography & contrast audit: fix all sub-12px / low-opacity text to meet WCAG AA — app-wide (Q3)
- [x] **C3** Replace native `<select>` with shadcn `Select` in ChannelGrid — `ChannelGrid.tsx` (Q9)

### Phase D — Modal unification (1 day)
- [x] **D1** Replace `Modal.tsx` with themed shadcn `Dialog` — `ChannelGrid.tsx` confirm dialogs (Q5)
- [x] **D2** Delete `Modal.tsx` after migration; validate focus trap, Escape, `aria-modal`
- ~~**D3** Patch Modal.tsx individually~~ — superseded by D1

### Phase E — Settings UX (1 day)
- [x] **E1** Add Settings as labeled tab in `WORKSPACE_TABS`; remove or repurpose gear icon — `App.tsx` (Q4)
- ~~**E2** Split `SettingsView.tsx`~~ — **deferred** (Q13)

### Phase F — Destructive actions & consistency (1 day)
- [x] **F1** Bulk freeze/unfreeze: add confirmation dialog matching command palette — `ChannelGrid.tsx` (Q10)
- [x] **F2** HistoryView delete: add confirmation or undo toast — `HistoryView.tsx`
- [x] **F3** Start ID field behind appearance/advanced toggle — `ChannelCard.tsx` (M11)
- [x] **F4** Telegram character count warning in SummaryView publish — N7

### Phase G — Nice-to-have (backlog)
- [x] **G1** Loading skeletons on initial data load — N1
- [x] **G2** Keyboard shortcuts reference (`?` key or header link) — N3
- [x] **G3** PostCard max-height with expand/collapse — N4
- [x] **G4** Auth/TG theme sync on redirect — N6

---

## 7. Out of Scope / Already In Progress

- **Command palette** (IDEA-001/004/005/007): implemented, keyboard UX in progress — not audited for new issues here
- **Admin template shell** (`/_layout/*`): separate design system, separate audit scope
- **Auth pages** (`/login`, `/signup`, `/recover-password`, `/reset-password`): template-originated, known minor issues (auth/TG theme mismatch flagged as N6)
- **`SettingsView.tsx` backend-facing sections** (Network, Publishing bot config): functional correctness not reviewed, only visual/UX
- **Backend API responses** affecting UI: not in scope
- **`TG-Summarizer/`** original reference: not in scope
- **Hover translation**: deferred by MEMORY.md
- **Mode B multi-user tenancy**: out of scope
