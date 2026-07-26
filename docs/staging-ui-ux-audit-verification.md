# Staging UI/UX Audit — Re-verification & Fix Plan

**Verified:** 2026-07-26 against `acdf1ca` (origin/main)
**Audit under review:** `docs/staging-ui-ux-audit.md` (written 2026-07-25 at `036be65`)
**Method:** static verification against the working tree — every finding re-traced to code.
Baseline confirmed green before planning: `tsc --noEmit` clean, 482/482 unit tests pass.

## 0. What changed between the audit and now

19 commits landed. Frontend-relevant ones:

| Commit | Effect on the audit |
|---|---|
| `03b71ed` Channel photo in post headers | **Fixes D8**, partly addresses B3 |
| `3acedb9` Vite 8 (Rolldown) | Changes how B4 must be fixed — `esbuild.drop` is gone |
| `522e410` Settings search test id | Unrelated to the audit (e2e fix) |
| `3d413a8`/`bc927a8`/`277d7c1` dep upgrades | No audit impact |

Everything else in the audit still reproduces in code.

---

## 1. Corrections to the audit

The audit is broadly accurate. Seven findings need amending — four where it was
pessimistic, three where the stated root cause is wrong or shallower than the truth.

### Already fixed — close these

**D8 (post headers drop the avatar)** — `03b71ed` added `ChannelAvatar` to `PostCard.tsx:228`.
The casing half was never a real defect: `PostCard.tsx:244` uses CSS `uppercase`
(`text-transform`), so the DOM text and the accessible name keep `@ReutersWorldChannel`. **Close D8.**

### Overstated — scope reduces

**B3 (N+1 avatar fetches)** — `03b71ed` added `lib/channels/channel-photo-cache.ts`, a
session cache keyed `channelId::photoUrl` that dedupes concurrent and repeat fetches. So a
feed of N posts over M channels now does M fetches, not N. **But the finding is not closed:**
it is still one request per channel on a cold load, and the responses still carry no
long-lived `Cache-Control`, so a page refresh re-fetches all of them. Remaining work is
batching + cache headers, not deduping.

**E1 (four unlabeled header icon buttons)** — half wrong. All four *do* have tooltips
(`App.tsx:300-355`). What they lack is an `aria-label`; a tooltip is not an accessible name,
so a screen reader still reads four unnamed buttons. **The a11y half stands, the "no tooltip"
half does not.**

**C9 (header theme control reads as broken)** — partly addressed. `App.tsx:144-149` now
computes a tooltip that names the current mode and the next one ("System theme (follows OS) —
click for Light"), which is what the audit asked for. The remaining valid complaint is that
the control exists in three places, against `CLAUDE.md`'s "do not add a second theme toggle".

**C11 (Discover filters interactive with nothing to filter)** — still true, but a proper
generate-prompt empty state now exists (`DiscoverView.tsx:352-378`). The only defect left is
that `DiscoverFilterBar` renders unconditionally at line 319, *above* that empty state.
One-line gate, not a redesign.

### Root cause was wrong — fix target moves

**A4 (bidi leak)** — the audit blamed `dir="auto"` resolving RTL from neighbouring Persian
content. That is not it. Only two files in the whole app use `dir="auto"` (`PostCard.tsx`,
`ChannelCard.tsx`) and both apply it correctly to user content. The real cause is
`SummaryView.tsx:335`:

```tsx
<div dir={isRTL ? "rtl" : "ltr"} className={...}>
```

This wraps the **entire report card** — the AI-generated body *and* the English chrome
(the "Telegram chars: n/m" counter, the "Message may exceed…" warning, the action buttons).
When `aiLanguage` is Persian the whole card flips, so English chrome inherits RTL. The fix is
to scope `dir` to the markdown body only, not to widen a `dir="auto"` sweep.

**A7 (titles hard-clip mid-glyph, no ellipsis)** — `ChannelCard.tsx:409` already *has*
`truncate`. It does nothing, because the same element is also `flex items-center gap-2`:

```tsx
<h4 className="font-bold text-lg leading-tight truncate mb-1 text-app-ink flex items-center gap-2">
```

`text-overflow: ellipsis` applies to a block container's line box. Making the `<h4>` a flex
container turns the title text into an *anonymous flex item*, which `text-overflow` does not
reach — so you get `overflow: hidden`'s hard clip and no ellipsis. Exactly the reported
symptom. Fix: wrap the text in its own `<span className="truncate">` and add `min-w-0`.
Adding `truncate` in more places would not have helped.

**A6 (model badge vs chip disagree)** — the audit marked this `OBSERVED`, root cause not
traced. It is now **CONFIRMED**, and it is worse than a display bug.
`lib/commands/history-selection.ts:39-40`:

```ts
if (summary.model && !isPastedSummaryModel(summary.model)) {
  ctx.settings.setSelectedModel(summary.model)
}
```

Opening a saved report **overwrites the user's global "model for the next generation"
setting**. The chip (`SummaryConfig.tsx:64`, a `<select value={selectedModel}>`) then shows
that global value; when the record's model id is not in `MODELS`, the `<select>` falls back to
rendering its first option — `Gemini 3 Flash` — which is precisely the reported symptom. So A6
is the A3 root cause *plus* an unwanted global side effect, in the same class as C8.

### Hypothesis promoted to confirmed

**A3 (AI Model segmented control shows nothing selected)** — the audit's enum-mismatch theory
is correct and provable without staging. `lib/settings/schema.ts:162` declares
`selectedModel: stringSetting("selectedModel", DEFAULT_MODEL)`, and `stringSetting` (line 43-55)
uses `schema: z.string().min(1)`. **Any non-empty string validates.** There is no check that
the persisted value is one of `MODELS[].id`, so a stale id survives, is restored, matches no
option in `TgSegmentedControl`, and nothing renders selected. `DEFAULT_MODEL` itself is fine
(`gemini-3-flash-preview`, present in `MODELS`, and the root `.env` sets the same value).

The same gap affects every enum-rendered setting declared with `stringSetting`, not just this
one. Fix once, in the schema layer.

### Blocker removed

**B1 (IndexedDB init on the critical path)** — the audit said this "needs an architecture
decision first" and told the reader to check `docs/migration/DECISIONS.md`. Checked:
**decision 5 (Offline mode → option C) already rules on it.** IndexedDB stays as the
read-only offline cache; the app must remain browsable when the API is down. So option 3
("retire the mirror") is off the table, and **no new sign-off is needed** — B1 is options 1+2
only: move init off the critical path, and make the retention pass guarded and idempotent so
StrictMode cannot double-delete.

### One correction to a suggested fix

**B4 (console.log ships to production)** — the audit suggests Vite's `esbuild.drop:
["console"]`. That option no longer applies: `3acedb9` moved the repo to **Vite 8 / Rolldown**,
which uses Oxc, not esbuild. The `esbuild` config key is gone. Use Rolldown's minifier options
or — better and testable — route through a small `logger` util gated on `import.meta.env.DEV`.
`vite.config.ts` currently sets no `drop`/`minify`/`define` at all.

---

## 2. Verification results — all 37 findings

Legend: **BROKEN** = re-traced to code today · **FIXED** = resolved since the audit ·
**PARTIAL** = materially reduced, remainder listed · **RUNTIME** = needs a browser session,
not decidable statically.

### A — Confirmed defects

| ID | Status | Evidence |
|---|---|---|
| A1 | **BROKEN** | `DatabaseManagement.tsx:329-334` — `focus === "danger"` still sets only `showTablesSection`. `DangerPanel.tsx` is still a bare confirm dialog. |
| A2 | **RUNTIME** | 5-query gate confirmed at `SettingsHub.tsx:89-122`. Ghosting needs a browser; `motion` is used in ~20 components. |
| A3 | **BROKEN** | `schema.ts:43-55` — `z.string().min(1)`, no enum validation. Root cause proven. |
| A4 | **BROKEN** | `SummaryView.tsx:335` — see correction above. |
| A5 | **BROKEN** | `HistoryView.tsx:735` — `{s.text.substring(0, 200)}...` unchanged. |
| A6 | **BROKEN** | `history-selection.ts:39-40` — see correction above. Now confirmed. |
| A7 | **BROKEN** | `ChannelCard.tsx:409` — see correction above. |
| A8 | **BROKEN** | `ProxyPanel.tsx:149` renders `value={defaultProxyUrls}` unmasked. |

**A8 note.** The audit says the masking logic "already exists in the codebase and is simply not
used by the editor". It exists in **Python** — `backend/app/services/network_settings.py:65`,
`redact_proxy_url()` — applied when writing network logs
(`sync_orchestrator.py:130`, `followed_channels.py:48`). There is **no** masking helper in the
frontend; grep for `***` in `frontend/src` returns nothing. So this is a port, not a reuse.

### B — Performance

| ID | Status | Evidence |
|---|---|---|
| B1 | **BROKEN** | `cache.ts:51-55`, `StrictMode` at `main.tsx:83`. Architecture question resolved — see above. |
| B2 | **BROKEN** | `ChannelGrid.tsx:180`, `ChannelGridBody.tsx:99`. No virtualization lib in `package.json`. |
| B3 | **PARTIAL** | Dedupe landed; batching + cache headers remain. |
| B4 | **BROKEN** | 10 `console.log` in `cache.ts`, 18 in `src/` total. No `drop` in `vite.config.ts`. Fix method changed — see above. |
| B5 | **BROKEN** | `api/data.ts:291` still builds a GET query string; backend `data.py:641` is `@router.get`. |

### C — Information architecture

| ID | Status | Evidence |
|---|---|---|
| C1 | **BROKEN** | `ChannelGridBody.tsx:9-10,27-28` receives both counts; used only for the empty state at 73/86. Never displayed. |
| C2 | **BROKEN** | `DatabaseManagement.tsx:370` — `<DatabaseStatsCards dbStats={dbStats} />` takes no `sizeSource`; the toggle reaches only `TableSizesPanel` and `QueryPanel`. |
| C3 | **BROKEN** | `TagConfig.tsx:23,57` — `selectedChannels.size` vs. a separately derived preview list. |
| C4 | **RUNTIME** | Needs a browser to confirm the ~300px height claim. |
| C5 | **RUNTIME** | Needs a browser at 1440px. |
| C6 | **BROKEN** | `CommonlyUsedSection.tsx:53` — `max-w-2xl` unchanged. |
| C7 | **BROKEN** | `App.tsx:97,490` — `scrollContainerRef` exists; nothing resets `scrollTop` on `?tab=` change. |
| C8 | **RUNTIME** | Same file as A6; the mutation mechanism is confirmed, the "POSTS IN SCOPE" figure is not. |
| C9 | **PARTIAL** | Tooltip landed; three control locations remain. |
| C10 | **RUNTIME** | Needs a browser. |
| C11 | **PARTIAL** | `DiscoverView.tsx:319` — filter bar renders above the empty state. One-line gate. |

### D — Content & copy

| ID | Status | Evidence |
|---|---|---|
| D1 | **BROKEN** | `AppearanceSection.tsx:91`, `DatabaseManagement.tsx:457` unchanged. |
| D2 | **BROKEN** | `App.tsx:287` `v1.0` · `AppearanceSection.tsx:99` `2.5.0-stable` · `package.json:4` `1.0.0`. |
| D3 | **RUNTIME** | Needs staging data to see `pes` and `Persian` side by side. |
| D4 | **RUNTIME** | Needs a generated report. |
| D5 | **BROKEN** | `toc.ts:97` "Diagnostics" → `logs/LogsHeader.tsx:23` "System Logs". `TagConfig.tsx:57` `channel(s)`. |
| D6 | **BROKEN** | `SummaryConfig.tsx:17` destructures exactly two controls (model, language). |
| D7 | **BROKEN** | `PostFilter.tsx:317-337` — numeric field shows `0`, "Unlimited" chip appears at `=== 0`. |
| D8 | **FIXED** | `PostCard.tsx:228`. Close it. |

### E — Accessibility

| ID | Status | Evidence |
|---|---|---|
| E1 | **PARTIAL** | Tooltips present; no `aria-label` on any of the four. |
| E2 | **BROKEN** | `App.tsx:434` — `onClick={() => setActiveTab(...)}`; no `role="tab"`, no `aria-current`, no `<Link>`. |
| E3 | **RUNTIME** | Needs a browser. |
| E4 | **RUNTIME** | Hover-reveal needs a browser. |
| E5 | **RUNTIME** | Tour behaviour needs a browser. |
| E6 | **RUNTIME** | The audit itself flags this as needing re-verification. |
| E7 | **BROKEN** | `App.tsx:382-402` — exactly 6 bindings listed. |

**Totals:** 1 fixed · 4 partial · 20 broken · 12 need a browser session.

---

## 2b. Batch 1 — shipped 2026-07-26

| ID | What changed |
|---|---|
| A3 | `stringSetting` **deleted**. `selectedModel`, `translationModel`, `aiLanguage`, `translationTargetLanguage` now use a new `oneOfSetting` (`schema.ts`) that validates membership, so `store.ts`'s existing `safeParse` → default fallback finally applies. No string setting can skip validation any more — the footgun is gone, not just unused. |
| A6 | `history-selection.ts` no longer calls `setSelectedModel`. `setSelectedModel` dropped from the context type and from `App.tsx`. |
| A8 | New `lib/network/maskProxyUrl.ts` (+12 tests, verified byte-identical to the Python `redact_proxy_url` on 10 shared cases). Applied at all **three** leaking sites in `ProxyPanel.tsx` — the editor, the per-proxy overrides list, and the test-results list. The audit named only the editor. |
| A1 | `danger` removed from `toc.ts` (nav entry + id union), `catalog.ts` (`panel-danger`), `SettingsHub.tsx`, and `DatabaseManagement.tsx` (focus type, `showTablesSection`, the pointless `SettingAnchor`). |

**Two things worth knowing:**

*A8's masked editor is read-only.* The textarea shows a masked projection, and a
projection must never become an input value — editing it would persist `***` into
`defaultProxyUrls` and destroy the real credentials. Making it `readOnly` while
masked removes the code path entirely rather than relying on careful `onChange`
handling. A **Reveal** toggle swaps in the live editable value and re-masks on blur.
It appears only when the list actually contains credentials, so the common case
stays frictionless.

*A6 stopped at the model.* `history-selection.ts` also calls `setAiLanguage`, which
is the same class of global mutation — but unlike the model it has a job: it drives
the direction and font the loaded report renders with. Fixing it properly means
deriving direction from `currentSummary.language` instead of the global, which is a
change to the exact `dir` logic that **A4** rewrites. Deferred to Batch 2 so both
land together rather than touching `SummaryView.tsx:335` twice.

Verified: biome clean, `tsc --noEmit` clean, **498/498** unit tests (was 482),
production build succeeds, and **61/61 e2e** pass (`summarizer.spec.ts` +
`settings-hub.spec.ts`, `--workers=1`, `PLAYWRIGHT_CHANNEL=chrome`).

> Note: `settings-hub.spec.ts` now passes in full. The two duplicate-`data-testid`
> failures previously recorded as pre-existing were fixed by `522e410`.

## 3. Fix plan

Batches are independently shippable and ordered by risk retired per unit of work.
Each batch = one PR off `origin/main`.

### Batch 0 — Browser verification pass (prerequisite for Batch 5)

The 12 `RUNTIME` findings cannot be settled from source. One staging session, at 1440×900 and
at a narrow viewport, resolving: A2, C4, C5, C8, C10, D3, D4, E3, E4, E5, E6 — plus the
audit's own untested gaps (§6: mobile, light theme beyond Channels, Tor/Destinations/Quick
Message/Retention/Transfer/Query). Output: this table updated, and the audit's §6 closed.

Do this *before* Batch 5, not before Batch 1 — the 20 BROKEN findings need no browser.

### Batch 1 — Security and silent data corruption

| ID | Change | Size |
|---|---|---|
| A8 | Port `redact_proxy_url` to `lib/network/maskProxyUrl.ts` (+ unit tests); mask `ProxyPanel.tsx:149` by default with a reveal toggle that re-masks on blur | S |
| A3 | Add an `enumSetting` helper to `schema.ts` using `z.enum(...)`; out-of-range persisted values fall back to the default and rewrite storage. Apply to `selectedModel`, `translationModel`, `aiLanguage` and every other `stringSetting` the catalog renders as `kind: "enum"` | S |
| A6 | Stop `history-selection.ts:40` mutating the global model. Render the loaded record's model from the record itself, visually distinct from the "next generation" selector | S |
| A1 | Danger Zone — needs a product call, see below | S or M |

**A8 is the one with a real-world exposure:** the audit captured a live staging proxy
credential. Masking the UI does not un-expose it — **the credential still needs rotating**,
and that is an operator action, not a code change.

**A1 needs a decision before it can be coded:**
- *Remove* — drop `danger` from `toc.ts` and the `SettingsSection` union (S). Honest, ships today.
- *Build* — a real Danger Zone panel (reset DB, purge posts, factory reset) and rename the
  existing dialog to `ClearTableConfirmDialog` (M). Destructive surface, needs its own care.

Either way `showTablesSection` must stop including `"danger"`.

### Batch 2 — Wrong information on screen

| ID | Change | Size |
|---|---|---|
| A5 | `stripMarkdown()` util + word-boundary truncation + `…` at `HistoryView.tsx:735` | S |
| A4 | Scope `dir` in `SummaryView.tsx:335` to the markdown body; leave chrome LTR | S |
| A7 | Wrap the title text in `<span className="truncate">`, add `min-w-0` + `title=` | S |
| C2 | Make `DatabaseStatsCards` obey `sizeSource`, or label the cards explicitly | S |
| C3 | Derive the selection count and the preview count from one source | S |
| C1 | Render "Showing X of Y" — props are already plumbed | XS |
| D1, D2 | Rewrite the IndexedDB copy to match the real architecture; single version source via Vite `define` | S |

### Batch 3 — Performance

| ID | Change | Size |
|---|---|---|
| B4 | `logger` util gated on `import.meta.env.DEV`; keep `console.error`. **Not** `esbuild.drop` — Rolldown | S |
| B5 | Move `posts/counts` to POST with a JSON body (frontend `api/data.ts:291` + backend `data.py:641`) | S |
| B3 | Batch the photo endpoint (one request for N handles) and add long-lived `Cache-Control` | M |
| B2 | Virtualize the grid with `@tanstack/react-virtual` | M |
| B1 | Move init off the critical path; guard the retention pass against the StrictMode double-invoke. **Mirror stays** — DECISIONS.md §5 | L |

### Batch 4 — Layout and flow

C7 (scroll reset on `?tab=` change) · C8 (banner, once its runtime behaviour is confirmed) ·
C6 (settings column measure) · C11 (gate the Discover filter bar) · A2 (skeletons + transition
strategy, after Batch 0) · C4, C5 (after Batch 0).

### Batch 5 — Polish

E1 (`aria-label` ×4) · E2 (router `<Link>` + tablist ARIA) · E7 (complete the shortcut list) ·
D5, D6, D7 (copy) · C9 (drop one of the two Settings theme duplicates) · E3-E6, C10, D3, D4
(after Batch 0).

---

## 4. Verification for every batch

```bash
bun run lint                                              # biome
cd frontend && bunx tsc -p tsconfig.build.json --noEmit    # typecheck
bun run --filter tg-summarizer-frontend test:unit          # 482 baseline
cd frontend && PLAYWRIGHT_CHANNEL=chrome bunx playwright test --workers=1 summarizer.spec.ts
```

E2E constraints (from `MEMORY.md`, still current): `--workers=1` is mandatory; Playwright's CDN
is geo-blocked here so `PLAYWRIGHT_CHANNEL=chrome` is required; two settings-hub specs fail on a
pre-existing duplicate-testid issue; three specs fail on a client-generation gap — scope runs to
`summarizer.spec.ts`. GH-hosted CI is billing-blocked: red ≠ failure. Commit signing is required.

Batches touching settings must update `lib/settings/schema.ts` / `catalog.ts` and their existing
tests (`catalog.test.ts`, `store.test.ts`, `search.test.ts`, `toc.test.ts`). Batch 1's A3 change
lands squarely there and should add a test that an out-of-range persisted enum value falls back.
