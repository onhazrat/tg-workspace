# Staging UI/UX Audit — Summarizer Dashboard

**Status:** Open — no fixes applied yet. This is a findings document only.
**Audited:** 2026-07-25
**Target:** `https://dashboard.staging.tgs.onhazrat.ir/summarizer` (staging), API at `https://api.staging.tgs.onhazrat.ir`
**Method:** Manual walkthrough in Chrome at 1440×900, dark + light themes. Every top-level tab and all 15 Settings sections were opened. Console and network traffic captured on a cold load.
**Frontend build audited:** `assets/summarizer-Cir6M0Ar.js`

---

## 0. How to use this document

Each finding has a stable ID (`A1`, `B2`, …). Findings are grouped by class, and §7 has a
suggested execution order. Every finding lists:

- **Symptom** — what a user sees.
- **Where** — `file:line` in this repo (verified against the working tree at audit time; line
  numbers drift, grep the quoted snippet if they don't match).
- **Root cause** — confirmed, or explicitly marked as a hypothesis to check.
- **Suggested fix** — a starting direction, not a mandate.

**Confidence labels:**
- `CONFIRMED` — reproduced in the browser *and* traced to the code.
- `OBSERVED` — reproduced in the browser; root cause not yet traced.
- `HYPOTHESIS` — a specific, checkable theory. Verify before acting.

Nothing here was fixed. Nothing here is blocked on anything else unless stated.

### Reproducing the environment

```bash
# Local full stack (see CLAUDE.md for the full command reference)
uv sync
uv run fastapi dev backend/app/main.py --port 8000
bun install && bun run dev            # Vite on :5173, proxies /api → :8000
```

Most findings reproduce locally. The ones that need staging data volume (≈1,070 channels,
≈3.2M posts) are flagged inline. Staging is a self-hosted deploy; see `deployment.md`.

### Context a newcomer needs

- This app was migrated from a standalone browser-only app (`TG-Summarizer/`) into this
  FastAPI + React monorepo. **Several findings below are leftovers from that migration** —
  copy, and in one case a whole storage layer, that still assume the browser-only world.
- The frontend still runs a **client-side IndexedDB layer** (`frontend/src/lib/cache.ts`)
  alongside the PostgreSQL backend. This is intentional today (there's a migration path in
  `components/MigrationPrompt.tsx` and `settings/data/TransferPanel.tsx`), but it is the
  direct cause of the worst performance finding (B1). Decide the strategy before touching B1.
- Settings are schema-driven: `lib/settings/schema.ts` (persistence) +
  `lib/settings/catalog.ts` (UI/search/palette metadata). Add settings there, not as new
  `useState`. See `CLAUDE.md`.
- Server state is TanStack Query, always. `DataContext` derives from queries.
- TS/React style: biome, **no semicolons, double quotes**. Run `bun run lint`.
- CI test workflows are billing-blocked and never start — red ≠ failure. Only the
  self-hosted staging deploy runs. Commit signing is required.

---

## 1. Confirmed defects

### A1 — `?section=danger` renders the Table Sizes panel; there is no Danger Zone UI `CONFIRMED`

**Symptom.** Settings → **Danger Zone** highlights the nav item and sets the URL to
`?tab=settings&section=danger`, but the content area shows the **Database Management /
Table Sizes** panel. Waited 15s; it never resolves. There is no reachable Danger Zone surface.

**Where.**
- `frontend/src/components/SettingsHub.tsx:231` — `case "danger":` returns
  `<DatabaseManagement focus="danger" />`.
- `frontend/src/components/DatabaseManagement.tsx:326-335` — with `focus === "danger"`, the
  only flag set is `showTablesSection = true`. `showStats`, `showTransfer`, `showRetention`,
  `showAbout` are all false.
- `frontend/src/components/settings/data/DangerPanel.tsx` — **`DangerPanel` is not a section.**
  It is a bare `TgConfirmDialog` wrapper that renders nothing when `confirmModal` is null. It's
  the confirmation dialog for the per-table "clear" buttons, mounted unconditionally at
  `DatabaseManagement.tsx:467`.

**Root cause.** The settings TOC advertises a `danger` section that was never built as a panel.
The name collision with the existing `DangerPanel` confirm-dialog component probably masked this.

**Suggested fix.** Decide one of:
1. Build a real Danger Zone panel (reset DB, clear all channels, purge posts, factory reset) and
   render it for `focus === "danger"`; rename the existing dialog to `ClearTableConfirmDialog`.
2. Remove the `danger` entry from the TOC (`lib/settings/toc.ts`) and the `SettingsSection`
   union until such a panel exists.

Option 2 is the honest quick fix; option 1 is the real one. Either way, `showTablesSection`
should not include `"danger"`.

---

### A2 — Settings sections render blank or show stale content during transitions `OBSERVED`

**Symptom.**
- **Diagnostics** renders a completely empty content area for ~7 seconds — no skeleton, no
  spinner, no error — then shows "System Logs".
- **Runtime Config** shows `Loading runtime config…` for 4s+.
- On *every* section switch, the **previous** section's content stays visible at ~30% opacity
  during the transition, so it reads as "the wrong page loaded".

**Where.**
- `frontend/src/components/SettingsHub.tsx:88-120` — the `useEffect` that fires
  `loadLogs() / loadSyncLogs() / loadLLMLogs() / loadEmbeddingLogs() / loadNetworkLogs()` in a
  `Promise.all` when `activeSettingsTab` becomes `diagnostics | tools | network-telemetry`.
  Five log queries must all resolve before anything paints.
- The ghosting is a Framer Motion `initial={{ opacity: 0 }} / animate={{ opacity: 1 }}` pattern
  used across panels (e.g. `DatabaseManagement.tsx:338-343`) without a matching exit/key
  strategy, so old and new content overlap.

**Suggested fix.** Add skeletons for the logs panels; don't gate first paint on all five
queries (render the tab chrome immediately, stream each log list in). For the ghosting, either
drop the fade or wrap sections in `AnimatePresence mode="wait"` keyed on the section id.

---

### A3 — AI Model segmented control shows no selected option `CONFIRMED (symptom)` / `HYPOTHESIS (cause)`

**Symptom.** Settings → **Commonly Used** → `AI MODEL` row is flagged `MODIFIED`, but all three
options (`GEMINI 3 FLASH`, `GEMINI 3.1 PRO`, `GEMINI 3.1 FLASH LITE`) render in identical
low-contrast grey. No option appears active. Contrast with the `COLOR THEME` row directly above,
where `DARK` is clearly filled — that proves the component *can* render a selected state.

**Where.**
- `frontend/src/components/settings/SettingRow.tsx:115-127` — enum controls with `≤ 4` options
  render `<TgSegmentedControl size="dense" value={String(value)} …>`.
- `frontend/src/components/ui/tg-segmented.tsx:22-51` — `selected: true` →
  `bg-app-ink text-app-bg shadow-sm`; the `size:"dense" + selected:false` compound variant →
  `opacity-40`. So a selected dense chip *should* be a solid dark chip.
- `frontend/src/lib/settings/catalog.ts:289-301` — `selectedModel` entry; options come from
  `MODELS.map(m => ({ value: m.id, label: m.label }))`.
- `frontend/src/lib/settings/schema.ts:162` — `selectedModel: stringSetting("selectedModel", DEFAULT_MODEL)`.

**Hypothesis to check first.** The persisted `selectedModel` value is **not one of the current
`MODELS[].id` values** (likely a stale model id from before a model-list update), so
`String(value)` matches no option and nothing renders selected. Supporting evidence: the row is
flagged `MODIFIED`, i.e. the stored value differs from the default.

**How to verify.** In the browser console on staging:
```js
// compare the persisted value against the current option ids
localStorage.getItem("selectedModel")
```
then diff against `MODELS` in `frontend/src/lib/ai/models.ts` (or wherever `MODELS` is defined —
grep `export const MODELS`).

**Suggested fix.** Two layers:
1. Validate/coerce on read — if the persisted id isn't in `MODELS`, fall back to `DEFAULT_MODEL`
   and rewrite storage. `lib/settings/schema.ts` already declares legacy-key handling; extend it
   to legacy *values* for enum settings.
2. Make `TgSegmentedControl` defensive: when `value` matches no option, render a visible
   "unknown value" state instead of silently showing nothing selected.

**Related.** See A6 — likely the same root cause.

---

### A4 — Bidi/RTL leak: English UI strings render with punctuation on the wrong side `CONFIRMED`

**Symptom.** English sentences in app chrome render with the trailing period at the *start* of
the line, because the containing element inherits RTL direction from the Persian content locale.

Observed instances:
- Summary tab empty state: `.external AI and paste the response from History`
  (should be `…external AI and paste the response from History.`)
- Summary result header: `.Message may exceed Telegram single-message limit`

**Where.**
- `frontend/src/components/SummaryView.tsx:624` — `Message may exceed Telegram single-message limit.`
- The Summary empty-state copy is in the same file; grep `Ready to Summarize`.

**Root cause.** App chrome inherits `dir` from an RTL ancestor (or from a `dir="auto"` that
resolves RTL because neighbouring content is Persian). The first strong character of these
strings is Latin, but the *container* direction governs where the terminal `.` lands.

**Suggested fix.** Set `dir="ltr"` explicitly on chrome/UI text containers. Reserve `dir="auto"`
for user-generated and AI-generated content only (post bodies, channel bios, summary bodies).
Consider a small `<UiText>` wrapper so this can't regress silently, and add a lint rule or unit
test asserting chrome strings are LTR-wrapped.

**Scope note.** These two are the confirmed instances; the same class of bug is likely elsewhere.
Sweep all English strings that sit adjacent to RTL content.

---

### A5 — Raw markdown leaks into History previews `CONFIRMED`

**Symptom.** Every record in the History list shows literal asterisks in its preview:
`**🔴 Executive Summary**`, `**خلاصه مدیریتی (Executive Summary)**`.

**Where.** `frontend/src/components/HistoryView.tsx:735`
```tsx
{s.text.substring(0, 200)}...
```
Raw markdown source, truncated, no rendering and no stripping.

**Suggested fix.** Strip markdown for the preview (a small `stripMarkdown()` util is enough —
do **not** render full markdown in a list row). Also truncate on a word boundary rather than a
hard 200-char cut, and use `…` rather than `...`.

---

### A6 — Model badge and config chip disagree after loading a History record `OBSERVED`

**Symptom.** Clicking a History record loads it into the Summary tab. The record's own badge
reads `PRO 3.1`, but the Analysis Configuration chip at the top of the page flips to
`Gemini 3 Flash`. One of the two is misreporting which model produced the report.

**Where.** `frontend/src/components/HistoryView.tsx` (record → summary load path) and
`frontend/src/components/SummaryConfig.tsx` (the chip).

**Root cause.** Not traced. Likely the same enum-value mismatch as A3 — the record stores a
model id that doesn't resolve, and the chip falls back to the first/default option while the
badge renders the stored label verbatim.

**Suggested fix.** Investigate together with A3. The displayed model for a *loaded historical
record* should be read from the record and should be visually distinct from the "model to use
for the next generation" selector — right now one control is doing both jobs.

---

### A7 — Channel card titles hard-clip mid-glyph `CONFIRMED (symptom)`

**Symptom.** Long channel titles are cut off mid-character with no ellipsis and no tooltip:
- `Rerum Novarum // Intel, Br`
- `Middle East Spectator — M`
- `Bellum Acta - Intel, Urgent`

The sync status line overflows on *every* card: `Regular 7/25/2026, 1:58:54 AM · Dynamic `
(verified via DOM — `scrollWidth > clientWidth` on those nodes).

**Where.** `frontend/src/components/ChannelCard.tsx` (title and status-line elements).

**Suggested fix.** `truncate` / `text-ellipsis overflow-hidden whitespace-nowrap` on the title
plus a `title=` attribute or tooltip with the full value. For the status line, either shorten the
format (relative time + mode) or allow a second line.

---

### A8 — Proxy credentials rendered in plaintext `CONFIRMED`

**Symptom.** Settings → Network → **Proxy** lists full proxy URLs including passwords in a
plain text field:
```
socks5h://proxyuser:hunter2@198.51.100.24:6328
```
Note this is a **real staging credential** — treat it as exposed and rotate it.

The **Network Telemetry** panel masks the same values correctly (`socks5h://***@…`), so the
masking logic already exists in the codebase and is simply not used by the editor.

**Where.**
- `frontend/src/components/settings/network/ProxyPanel.tsx:149` — `value={defaultProxyUrls}`,
  rendered unmasked.
- `frontend/src/components/NetworkTelemetry.tsx` — has the working mask; grep `***` to find it.

**Suggested fix.** Mask by default with an explicit reveal toggle (and re-mask on blur). Extract
the telemetry masking into a shared util (`lib/network/maskProxyUrl.ts`) and use it in both
places. Consider whether the proxy list needs to reach the browser in full at all, or whether the
editor can work with server-side references.

**Also:** rotate the exposed staging proxy credentials.

---

## 2. Performance

### B1 — ~30 second client-side IndexedDB init on every page load, run twice `CONFIRMED`

**Symptom.** The long skeleton phase on the Channels tab. Console on a cold load:

```
12:54:03  [DB] Initializing database...
12:54:33  [DB] Deleted 1 posts older than 90 days.
12:54:33  [DB] Deleted 0 logs older than 7 days.
12:54:33  [DB] Initializing database...        ← second run
12:54:33  [DB] Deleted 1 posts older than 90 days.
12:54:33  [DB] Deleted 0 logs older than 7 days.
```

**30 seconds** between init and the retention pass completing. It then runs a **second** time
(React StrictMode double-invoke in dev-like builds), and each run performs **destructive work**
(deleting posts and logs).

**Where.**
- `frontend/src/lib/cache.ts:55` — `console.log("[DB] Initializing database...")`
- `frontend/src/contexts/SettingsContext.tsx:294` — the comment explains the retention pass:
  *"Keep the IndexedDB mirror inside the retention window; without this it…"*

**Why it matters.** This is the single biggest perceived-performance problem in the app, and it
sits on the critical path of first paint for every tab.

**Before fixing, decide the strategy.** The IndexedDB layer is a mirror of a PostgreSQL backend
that is now the source of truth. Options, roughly in increasing order of value:
1. Move init off the critical path — render from server queries immediately, hydrate the mirror
   in the background (`requestIdleCallback` / a worker).
2. Make the retention pass idempotent and guarded so StrictMode can't double-delete; run it on a
   schedule, not on every mount.
3. Retire the IndexedDB mirror for users who have already migrated (there's already a migration
   path in `MigrationPrompt.tsx` / `TransferPanel.tsx`), keeping it only as an offline cache.

Option 3 is the real answer if the product no longer needs offline-first, but it is an
architectural decision — **get sign-off before starting**, and check `docs/migration/DECISIONS.md`
for any prior ruling.

---

### B2 — No virtualization on the Channels grid `CONFIRMED`

**Symptom.** Scrolling the Channels tab is visibly janky; several 10-tick scroll gestures moved
less than one card row.

**Measured on staging** (DOM after scrolling to ~80 cards):
- ~9,874 DOM nodes
- ~935 `<button>` elements
- a single 10,129px scroll container (`div.min-h-0.flex-1.overflow-y-auto.p-8`)
- 80 channel cards rendered eagerly

**Where.**
- `frontend/src/components/ChannelGrid.tsx:180-192` — `visibleChannels` starts at **20** and
  grows via an infinite-scroll sentinel (`useScrollLoadMore`).
- `frontend/src/components/channel-grid/ChannelGridBody.tsx:99` —
  `channels.slice(0, visibleCount).map(…)`.

**Root cause.** Infinite scroll without windowing: cards are appended and never unmounted. With
~1,070 channels in the account, scrolling to the end would mount ~1,070 cards, each with ~12
interactive elements.

**Suggested fix.** Virtualize the grid (`@tanstack/react-virtual` pairs naturally with the
existing TanStack Query setup). Failing that, reduce per-card DOM weight — the tag chips and
per-tag remove buttons dominate the node count.

**Related:** C1 (no total-count indicator on the same grid).

---

### B3 — N+1 avatar fetches on load `CONFIRMED`

**Symptom.** One request per visible channel on every Channels load:

```
GET /api/v1/telegram/channel-photo/Khabarrast
GET /api/v1/telegram/channel-photo/naya_foriraq
GET /api/v1/telegram/channel-photo/TelegramTips
… 20 total on first paint, growing as you scroll
```

**Where.** `frontend/src/components/ChannelAvatar.tsx`; backend route under
`backend/app/api/routes/` (grep `channel-photo`).

**Suggested fix.** Batch (one request for N handles), and/or make the responses long-cacheable
(`Cache-Control: immutable` with a content hash) so repeat loads are free. Channel avatars change
rarely; they're a good CDN/edge-cache candidate.

---

### B4 — Debug logging ships in the staging/production bundle `CONFIRMED`

**Symptom.** `[DB] …` logs appear in the console from `assets/summarizer-Cir6M0Ar.js` — a
built, minified bundle.

**Where.** `frontend/src/lib/cache.ts` — lines 55, 59, 228, 269, 272, 282, 311, 315, 364, 965
(and more; grep `\[DB\]`).

**Suggested fix.** Strip `console.log` at build (Vite `esbuild.drop: ["console"]` for production
targets) or route through a `logger` util gated on `import.meta.env.DEV`. Keep `console.error`.

---

### B5 — Very long GET query strings for post counts `CONFIRMED`

**Symptom.** The Channels tab issues:
```
GET /api/v1/data/posts/counts?channelNames=rnintel%2Censafnews%2C… (43 names, ~700 chars)
    &startDate=1784421000000&endDate=1784442600000
```

**Where.** `frontend/src/hooks/` (grep `posts/counts`); backend route in
`backend/app/api/routes/data.py`.

**Why it matters.** Works at 43 channels; will hit proxy/server URL limits as selections grow
toward the ~1,070 channels present in the account.

**Suggested fix.** `POST` with a JSON body, or scope by group/tag id rather than enumerating
names. If it must stay a GET for cacheability, cap the batch size and chunk client-side.

---

## 3. Information architecture & layout

### C1 — Channels grid gives no sense of scale `CONFIRMED`

**Symptom.** The grid loads 20 cards and grows on scroll, but there is **no "showing X of Y"
indicator anywhere**. You cannot tell whether you're looking at everything or a slice.

For scale: Setting Groups reports 596 + 345 + 24 + 2 + 100 + 3 = **1,070 channels**.

**Where.** `frontend/src/components/channel-grid/ChannelGridBody.tsx` already receives
`totalChannelCount` and `filteredChannelCount` as props (lines 9-10) — **they're just not
displayed**. This is a cheap fix.

**Suggested fix.** Render `Showing {visibleCount} of {filteredChannelCount}` (and
`of {totalChannelCount} total` when a filter is active) above or below the grid. Pairs naturally
with B2.

---

### C2 — Three different channel/post counts on one screen `CONFIRMED`

**Symptom.** Settings → Data → **Table Sizes** shows mutually inconsistent numbers:

| Where | Channels | Posts |
|---|---|---|
| Header summary cards | 1,070 | 3,242,428 |
| Per-table grid, `DATA SOURCE: BACKEND DB` | 903 | 3,319,288 |
| Per-table grid, `DATA SOURCE: LOCAL (BROWSER)` | 923 | 623,036 |

**Root cause.** The header summary cards (`RECORDS` / `STORAGE` / `INFO`) do **not** respond to
the `DATA SOURCE` toggle — they appear to report a third thing (IndexedDB quota for `STORAGE`,
something else for `RECORDS`).

**Where.** `frontend/src/components/DatabaseManagement.tsx` — `DatabaseStatsCards` (rendered at
~line 370 under `showStats`) vs. the table grid under `showTablesSection`.

**Suggested fix.** Make the header cards obey the `DATA SOURCE` toggle, or label them explicitly
("Browser cache" vs "Server") so the difference is intentional rather than confusing. Also note
`Last calculated: 5d ago` — stale figures presented as current.

---

### C3 — Tag tab: selection count ≠ preview count `CONFIRMED`

**Symptom.** Header reads `43 selected channel(s)`; the preview immediately below reads
`PREVIEW (50 channels)`.

**Where.** `frontend/src/components/TagView.tsx` / `TagConfig.tsx`.

**Suggested fix.** Establish which is authoritative and derive both from it. (Also fixes the
`(s)` pluralization hack — see D5.)

---

### C4 — The tag filter wall consumes the entire first screen `OBSERVED`

**Symptom.** On Channels, ~65 tag chips in 11 rows occupy ~300px above the fold. You must scroll
past the whole wall every time to reach the first channel card.

**Where.** `frontend/src/components/ChannelGrid.tsx` (filter header region) and
`frontend/src/components/channel-grid/`.

**Suggested fix.** Collapse by default showing the top ~8 tags by count plus a "+57 more"
expander; or fold tag selection into the existing "Search tags…" field with a chip-input pattern.
Persist the expanded/collapsed state via `lib/settings/schema.ts`.

---

### C5 — Posts tab wastes ~80% of horizontal space `OBSERVED`

**Symptom.** At 1440px, post media renders as a ~200px-wide column centered inside a ~1145px
card — roughly 900px of empty background per post. Meanwhile body text runs the **full** 1100px
width, well past a comfortable reading measure (~65-75ch).

**Where.** `frontend/src/components/PostCard.tsx`, `frontend/src/components/PostFeed.tsx`.

**Suggested fix.** Constrain the post column to a readable measure (`max-w-3xl`) and center it,
or move to a two-column layout (media left, text right) at wide viewports. Media should scale up
to the column width rather than sitting at intrinsic size.

---

### C6 — Settings content is pinned left in a much wider panel `OBSERVED`

**Symptom.** Settings rows end at x≈910 inside a panel that runs to x≈1370 — ~460px of
permanently empty column. **Bot Credentials** is the worst case: a ~440px-wide form in a
~1000px panel.

**Where.** `frontend/src/components/settings/CommonlyUsedSection.tsx:52` —
`<div className="space-y-2 max-w-2xl">`. Similar constraints across sibling sections;
`components/BotManagement.tsx` for the bot form.

**Suggested fix.** Either center the constrained column in the panel, or widen the value column
so controls align to the right edge. `max-w-2xl` is a reasonable measure for *text*, but the
row's control cluster shouldn't inherit it.

---

### C7 — Scroll position leaks across unrelated views `OBSERVED`

**Symptom.**
- Channels → Posts lands you **mid-list** in Posts rather than at the top of the filter panel.
- Clicking a History record opens the Summary tab scrolled to the **middle** of the report.

**Where.** The shared scroll container is `div.min-h-0.flex-1.overflow-y-auto.p-8` in the
summarizer shell (`frontend/src/App.tsx`). Tab changes swap children without resetting
`scrollTop`.

**Suggested fix.** Reset scroll on `?tab=` change. For the History→Summary case specifically,
scroll to the top of the loaded report. Consider preserving per-tab scroll positions in a ref map
if returning to a tab should restore position — but cross-tab bleed is never right.

---

### C8 — Loading a History record silently mutates global scope `OBSERVED`

**Symptom.** Opening a History record changed the header stat `POSTS IN SCOPE` from **46** to
**468** with no indication that the current working set had been replaced.

**Where.** `frontend/src/components/HistoryView.tsx` (record load) → `DataContext` /
`PostFilter` state.

**Suggested fix.** Either (a) load historical records into a read-only viewer that doesn't touch
the live filter, or (b) show an explicit banner — "Viewing a saved analysis from Jul 19 · 468
posts · [Restore my filters]".

---

### C9 — Theme control exists in three places; the header one reads as broken `CONFIRMED`

**Symptom.** Theme can be set from: the header icon, Settings → Commonly Used, and
Settings → Appearance. The header icon is an **unlabeled 3-state cycle** (dark → system →
light). Clicking dark → system produced *no visible change* (system resolves to dark), so it
reads as a dead button.

**Where.**
- `frontend/src/App.tsx` (header icon button)
- `frontend/src/components/settings/CommonlyUsedSection.tsx` (via catalog `theme` entry,
  `lib/settings/catalog.ts:38`)
- `frontend/src/components/settings/AppearanceSection.tsx` (`INTERFACE & APPEARANCE`)
- Owner: `frontend/src/components/theme-provider.tsx` (`localStorage: vite-ui-theme`)

**Note:** `CLAUDE.md` explicitly says *"do not add a second theme toggle"* — there are now three.

**Suggested fix.** Keep the header control (it's genuinely useful) but give it a tooltip/label
showing the current mode, and make it a 3-state segmented popover rather than a blind cycle.
Drop one of the two Settings duplicates.

---

### C10 — Tag preview is 50 rows of "No changes" `OBSERVED`

**Symptom.** The tag preview table renders every selected channel with `CURRENT TAGS`,
`PROPOSED`, and `ACTION` — and on an unchanged run, all 50 rows say `No changes`. There is no
diff highlighting, no "changes only" filter, and no sticky table header (column headers scroll
away immediately).

Tag History entries are also indistinguishable from one another —
`ADD MODE • COMPLETED / 50 channels / 7/22/2026, 9:18:35 PM` — with only a delete icon. No detail
view, no undo, no indication of *what* changed.

**Where.** `frontend/src/components/TagView.tsx`.

**Suggested fix.** Default the preview to changed rows only with a "show unchanged (47)" toggle;
diff-highlight added/removed tags inline; make the table header sticky. For history, add an
expandable detail row and, ideally, an undo.

---

### C11 — Discover filters are interactive with nothing to filter `OBSERVED`

**Symptom.** With `Candidates: 0` and no report generated, the `SIGNALS` / `SHOW` / `MIN HITS`
chips and the "Filter by name…" input all render fully enabled.

**Where.** `frontend/src/components/DiscoverView.tsx`.

**Suggested fix.** Hide or disable the filter bar until a report exists; the empty state's
`GENERATE DISCOVERY REPORT` call to action should be the only affordance.

---

## 4. Content & copy

### D1 — Stale pre-migration copy claims data is stored in the browser `CONFIRMED`

This app uses **PostgreSQL** as its source of truth. Two places still tell the user otherwise:

**`frontend/src/components/settings/AppearanceSection.tsx:88-93`**
> "This dashboard is designed for high-speed monitoring and analysis of Telegram channels. **All
> data is stored locally in your browser's IndexedDB.** AI processing is powered by Google Gemini.
> No data is sent to external servers except for Telegram scraping and AI analysis."

**`frontend/src/components/DatabaseManagement.tsx:456-464`** — an "About Local Storage" block:
> "This application uses your browser's IndexedDB to store all channel data and posts locally. No
> data is sent to our servers except for the content you explicitly send to AI models…"

Also `DatabaseManagement`'s subtitle: *"Monitor storage usage and manage your **local** data."*

**Suggested fix.** Rewrite to describe the actual architecture: PostgreSQL on the server, with a
browser-side cache. Note the AI provider line is also narrower than reality — the backend has a
pluggable provider registry (`backend/app/ai/registry.py`, ADR-008), even if Gemini is the only
one configured.

---

### D2 — Version numbers contradict each other `CONFIRMED`

| Where | Value |
|---|---|
| `frontend/src/App.tsx:287` | `Technical Scraper & AI Analyst v1.0` |
| `frontend/src/components/settings/AppearanceSection.tsx:98-99` | `Core Version 2.5.0-stable` |
| `package.json:4` | `"version": "1.0.0"` |

`2.5.0-stable` is hardcoded and almost certainly inherited from the standalone app.

**Suggested fix.** Single source of truth — inject `package.json` version at build via Vite
`define`, and render it in both places. Same file also hardcodes
`Storage Engine: IndexedDB (idb)` (see D1).

---

### D3 — Language badges use three different naming systems `CONFIRMED`

On a single Channels screen: `pes`, `arb`, `Persian`, `English`, `Urdu` — ISO 639-3 codes and
display names mixed together, sometimes for the *same* language (`pes` and `Persian` both appear).

**Where.** `frontend/src/components/ChannelCard.tsx` (language badge).

**Suggested fix.** Normalize to display names with the code as a tooltip. The underlying data
probably has both a detected code and a user-set label — pick one for display.

---

### D4 — Machine strings surfaced directly to users `CONFIRMED`

Discover → Discovery Scope:
- `Date range: 2026-07-24T23:54 – 2026-07-25T00:24` — raw ISO 8601
- `Posts with signals: 0 fwd · 0 men · 0 link` — cryptic abbreviations

**Where.** `frontend/src/components/DiscoverView.tsx`.

**Suggested fix.** Format dates for humans (the app already has `RelativeTime.tsx`); spell out
`forwards`, `mentions`, `links`.

---

### D5 — Label inconsistencies `CONFIRMED`

- Sidebar says **DIAGNOSTICS**; the page it opens is titled **SYSTEM LOGS**.
- Sidebar label truncated: **NETWORK TELEMET…** (`lib/settings/toc.ts`).
- `43 selected channel(s)` — `(s)` pluralization hack (see also C3).
- `ANALYSIS HISTORY / 35 Records Found` — title case in an otherwise all-uppercase UI.
- History metadata renders the model as `3.1 PRO` on some rows and `GEMINI 3.1 PRO` on others.

**Suggested fix.** Reconcile nav labels with page titles; shorten "Network Telemetry" or widen
the sidebar; use a proper pluralization helper; normalize model display through one formatter.

---

### D6 — "Analysis Configuration — setup your summary parameters" over-promises `OBSERVED`

The panel exposes exactly two controls (model, language). The heading implies a configuration
surface.

**Where.** `frontend/src/components/SummaryConfig.tsx`.

**Suggested fix.** Either rename to match ("Model & language") or surface the parameters that
actually exist elsewhere (temperature, prompt context toggles — those live on the Channels tab
today, which is an odd home for them).

---

### D7 — Post limit reads `0` while `UNLIMITED` is selected `OBSERVED`

Posts → `POST LIMIT & ORDER`: the numeric field shows `0` with the `UNLIMITED` chip active.
Ambiguous whether `0` means "none" or "no limit".

**Where.** `frontend/src/components/PostFilter.tsx`.

**Suggested fix.** Disable/blank the numeric field when `UNLIMITED` is active, or show a
placeholder reading `∞`.

---

### D8 — Post headers uppercase the handle and drop the avatar `OBSERVED`

Posts render `@REUTERSWORLDCHANNEL`, losing the real casing `@ReutersWorldChannel`. They also show a single-letter
placeholder where the Channels tab already has a real avatar (fetched via
`/api/v1/telegram/channel-photo/{name}` — see B3).

**Where.** `frontend/src/components/PostCard.tsx`.

**Suggested fix.** Preserve casing (use CSS `text-transform` only if the design demands it, and
keep the accessible name intact); reuse `ChannelAvatar.tsx`. If B3 is batched, the avatar is
already in cache and this is free.

---

## 5. Accessibility

All `OBSERVED` unless noted. None of these were traced to specific lines beyond what's listed.

**E1 — Four unlabeled icon buttons in the header.** Command palette, help/tour, keyboard
shortcuts, and theme all render as bare icons with no accessible name and no tooltip.
`read_page` returns them as `button [ref_1] type="button"` with no name.
*Where:* `frontend/src/App.tsx`. *Fix:* `aria-label` + tooltip. Note `TgIconButton`
(`components/ui/`) already supports both — `SettingRow.tsx:150` uses it correctly with
`aria-label` and `tooltip`, so the pattern exists and just isn't applied in the header.

**E2 — Main navigation is buttons, not links.** The 8 tabs are `<button>` elements with no
`role="tab"` / `aria-current` and no `href`. Consequences: no cmd-click, no open-in-new-tab, no
middle-click, and screen readers get no tab semantics — even though each tab *is* addressable
via `?tab=`.
*Fix:* TanStack Router `<Link>` with `search={{ tab }}`, plus proper tablist ARIA.

**E3 — Chip-styled `<select>` elements have no dropdown affordance.** Summary tab's model and
language selectors are native `<select>` styled as chips with no chevron — they don't read as
interactive.
*Where:* `frontend/src/components/SummaryConfig.tsx`.

**E4 — Per-card actions are hover-only.** Channel cards reveal star / re-sync / delete icons on
hover. Unreachable by keyboard, invisible on touch.
*Where:* `frontend/src/components/ChannelCard.tsx`. *Fix:* also reveal on
`:focus-within`; consider an always-visible overflow menu.

**E5 — Onboarding tour is broken in three ways.** Triggered by the header `?` button:
1. The popover renders in a **light theme while the app is dark**.
2. Step 1 ("Add Channels") anchors its arrow to the tag-filter area, not the input it describes.
3. Step 2's tooltip sits half-off the bottom viewport edge, overlapping cards.

Tour is 10 steps and force-navigates to the Channels tab regardless of where you were.
*Where:* grep `Add Channels` / the tour library config.

**E6 — Command palette is visually a different product.** Sentence-case proportional type
against an all-uppercase mono UI; positioned mid-page rather than near the top.
*Where:* `frontend/src/components/CommandPalette.tsx`. Functionally it works well
(`cmd+shift+p`, Recent + Navigate groups).
*Also:* clicking the header ⌘ button did not open it in my session, while the keyboard shortcut
did — **verify this**, it may have been a double-toggle in my interaction rather than a bug.

**E7 — Keyboard shortcuts modal lists only 6 bindings.** Command palette, shortcuts, run, alt-run,
back/close, parent. No tab navigation (1-8), no `/` to focus search, no sync shortcut.
*Where:* grep `KEYBOARD SHORTCUTS`.

---

## 6. Not covered by this audit

Be explicit about the gaps so the next person doesn't assume coverage:

- **Generation flows were not triggered.** I deliberately did not run
  `GENERATE SUMMARY`, `GENERATE TAGS`, or `GENERATE DISCOVERY REPORT` on staging, to avoid
  kicking off heavy work unprompted (see `docs/discover-bulk-follow-load-investigation.md` for
  why load on staging is a sensitivity). **The populated/streaming/error states of Discover,
  Tag generation, and in-app Summary generation are unreviewed.**
- **Chat was not exercised.** Only the empty state was reviewed. No message was sent, so
  streaming, citation rendering, and error states are unreviewed.
- **Responsive/mobile was not tested.** `resize_window` did not take effect in my session
  (attempted at 420px and 500px; the window stayed 1511px). **No narrow-viewport verification was
  performed.** The grid uses `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
  (`ChannelGridBody.tsx:96`) so it likely reflows, but the filter bar, bulk-action bar, and
  Settings sidebar are untested below ~1000px. Test this properly with devtools device emulation.
- **Sections opened but not deeply reviewed:** Settings → Tor, Destinations, Quick Message,
  Retention, Transfer, Query.
- **Light theme** was checked on the Channels tab only. It reads fine there — no contrast
  problems found. Other tabs unverified in light mode.
- **No automated a11y scan was run.** Consider axe-core in the Playwright suite; see
  `docs/e2e-playwright-guide.md`.

---

## 7. Suggested execution order

Grouped so each batch is independently shippable.

### Batch 1 — Broken things and exposed secrets
| ID | Item | Est. |
|---|---|---|
| A8 | Mask proxy credentials **+ rotate the exposed staging credential** | S |
| A1 | Danger Zone renders the wrong panel | S (remove) / M (build) |
| A3 | AI Model selection invisible — verify the enum-value hypothesis first | S |
| A6 | Model badge/chip disagreement (likely same root cause as A3) | S |

### Batch 2 — Correctness of what's displayed
| ID | Item | Est. |
|---|---|---|
| A5 | Strip markdown from History previews | S |
| A4 | RTL/bidi leak into English chrome (sweep, not just the 2 known spots) | M |
| C2 | Table Sizes counts disagree | S |
| C3 | Tag selection vs preview count | S |
| D1, D2 | Stale IndexedDB copy + version mismatch | S |

### Batch 3 — Performance
| ID | Item | Est. |
|---|---|---|
| B4 | Strip console logs from production builds | S |
| B3 | Batch/cache avatar requests | M |
| B5 | Move posts/counts to POST or scope by group | S |
| B2 | Virtualize the Channels grid | M |
| B1 | IndexedDB init on the critical path — **needs an architecture decision first** | L |

### Batch 4 — Layout and flow
| ID | Item | Est. |
|---|---|---|
| C1 | "Showing X of Y" (props already plumbed) | XS |
| A7 | Title/status-line truncation | S |
| A2 | Section loading states + transition ghosting | M |
| C7, C8 | Scroll reset + scope-mutation banner | S |
| C4, C5, C6 | Density: tag wall, Posts measure, Settings column | M |

### Batch 5 — Polish
| ID | Item | Est. |
|---|---|---|
| E1-E7 | Accessibility set | M |
| D3-D8 | Copy normalization | S |
| C10, C11 | Tag diff view, Discover empty state | M |
| C9 | Consolidate theme controls | S |

---

## 8. Verification

For any change here:

```bash
# Frontend
bun run lint                                              # biome — no semicolons, double quotes
cd frontend && bunx tsc -p tsconfig.build.json --noEmit   # typecheck
bun run --filter tg-summarizer-frontend test:unit         # unit

# E2E — see MEMORY.md: must run serially, and Playwright's CDN is geo-blocked here
cd frontend && PLAYWRIGHT_CHANNEL=chrome bunx playwright test --workers=1
```

Known-good context before you start (from `MEMORY.md`):
- E2E **must** run with `--workers=1`; parallel runs fail randomly on shared-backend contention.
- Three Playwright specs fail on a pre-existing client-generation gap — scope runs to
  `summarizer.spec.ts`.
- GH-hosted CI test workflows are billing-blocked and never start. **Red ≠ failure.**
- Commit signing is required. A signing failure is a blocker to raise, not to route around.

If a change touches settings, add/adjust entries in `lib/settings/schema.ts` and
`lib/settings/catalog.ts` (there are existing tests: `catalog.test.ts`, `store.test.ts`,
`search.test.ts`, `toc.test.ts`).

---

## Appendix — raw evidence

**Cold-load console (staging, 2026-07-25):**
```
12:54:03  [LOG] [DB] Initializing database...
12:54:33  [LOG] [DB] Deleted 1 posts older than 90 days.
12:54:33  [LOG] [DB] Deleted 0 logs older than 7 days.
12:54:33  [LOG] [DB] Initializing database...
12:54:33  [LOG] [DB] Deleted 1 posts older than 90 days.
12:54:33  [LOG] [DB] Deleted 0 logs older than 7 days.
```
No errors or warnings were emitted.

**Cold-load API traffic (staging):** 21 requests, all `200`.
20 × `GET /api/v1/telegram/channel-photo/{handle}` + 1 ×
`GET /api/v1/data/posts/counts?channelNames=…43 names…&startDate=…&endDate=…`

**DOM measurements, Channels tab after scrolling to ~80 cards:**
```json
{ "domNodes": 9874, "buttons": 935, "images": 80, "channelCards": 80,
  "scrollContainer": { "class": "min-h-0 flex-1 overflow-y-auto p-8",
                       "scrollHeight": 10129, "clientHeight": 818 } }
```

**Setting Groups channel distribution:** default 596 · slow feed 345 · high velocity 24 ·
frozen 2 · restricted 100 · noise 3 = **1,070**
