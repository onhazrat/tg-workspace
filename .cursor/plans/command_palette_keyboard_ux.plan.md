---
name: Command Palette Keyboard UX
overview: Make every command palette mode and chained flow fully keyboard-operable — matching Raycast/VS Code conventions for navigation, Enter/Escape/Backspace, confirm dialogs, multi-pick stay-open flows, and disabled-row behavior. Plan only; no implementation.
todos:
  - id: audit-baseline
    content: Document per-mode keyboard matrix and reproduce top gaps manually
    status: completed
  - id: shared-palette-keyboard-hook
    content: Extract usePaletteKeyboard / PaletteSubViewHeader for back, hints, controlled selection
    status: completed
  - id: confirm-keyboard
    content: CommandConfirmDialog — autofocus, Enter/Escape, arrow between buttons, data-testid for E2E
    status: completed
  - id: list-modes-selection
    content: Apply controlled cmdk value/onValueChange to entity + search-results (mirror commands fix)
    status: completed
  - id: editor-keyboard
    content: Editor mode — footer hints, optional Shift+Enter newline, focus Apply after chained transitions
    status: completed
  - id: loop-and-disabled
    content: Enable loop={true} on list modes; verify Enter skips disabled rows; add regression tests
    status: completed
  - id: chained-flows-keyboard
    content: Keyboard smoke for add-tag, remove-tag, delete confirm, add-channel stay-open, search-results pick
    status: completed
  - id: e2e-keyboard-suite
    content: Playwright keyboard-only flows in summarizer.spec.ts; manual matrix checklist
    status: completed
  - id: idea-007-stub
    content: Add IDEA-007 to ideas log linking this plan
    status: completed
isProject: false
---

# Command Palette — Keyboard UX Plan

Make **all palette-started flows** fully operable without a mouse: root command list, entity pickers, editor sub-pages, in-palette search results, confirm steps, and chained multi-step flows (add tag, delete channel, import confirm, multi-pick select/deselect).

**Scope:** palette UI only (`CommandPalette.tsx` and direct children). Not whole-app a11y.

**Plan only — no implementation in this document.**

Detail idea stub: [IDEA-007](../docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md)

---

## 1. Audit — per mode (today vs gaps)

Legend: ✅ works | ⚠️ partial | ❌ gap

### `commands` (root list)

| Interaction | Today | Gap |
|-------------|-------|-----|
| **Open** | ✅ `Cmd/Ctrl+Shift+P` + header button | — |
| **Initial focus** | ✅ `requestAnimationFrame` → `CommandInput` | — |
| **Type-to-search** | ✅ Custom `filterAndRank`; `shouldFilter={false}` | — |
| **↑/↓ navigate** | ✅ cmdk + controlled `value`/`onValueChange` (`selectedCommandId`) | ⚠️ `loop={false}` — no wrap at list ends (differs from Raycast/VS Code) |
| **Hover vs keyboard** | ✅ Fixed via controlled selection + `firstNavigableId` reset on query change | ⚠️ Recent + grouped lists: verify arrow crosses group boundaries cleanly |
| **Enter** | ✅ cmdk `onSelect` → `handleSelectCommand` | ⚠️ Disabled rows: cmdk should skip; **untested** in E2E |
| **Escape** | ✅ Root stack → closes dialog | — |
| **Backspace (empty)** | ⚠️ Handler present but `modeStack.length <= 1` → no-op | ✅ Correct at root (no phantom back) |
| **Tab** | ⚠️ Radix focus trap; Tab may reach close (X) button | ❌ No documented Tab policy; may steal focus from list |
| **Disabled items** | ✅ `disabled` prop + reason hint | ⚠️ Enter on highlighted disabled row — verify cmdk blocks |
| **Recents group** | ✅ Shown when query empty | ⚠️ Duplicate command IDs in Recent vs group — cmdk `value` is id-only (OK) |

### `entity` (channel / tag / post / summary / table pickers)

| Interaction | Today | Gap |
|-------------|-------|-----|
| **Initial focus** | ✅ `entityInputRef` rAF (bug fixed 2026-06-24) | — |
| **Type-to-filter** | ✅ `entityQuery` + `filterChannelsByQuery` / extended candidates | — |
| **↑/↓ navigate** | ⚠️ cmdk default | ❌ **No controlled `value`** — same arrow/hover desync class of bug fixed in commands mode |
| **Enter** | ✅ `onSelect` → `handleEntityPick` | ⚠️ Chained flows (add-tag → editor, remove-tag → tag-pick) — keyboard only through if each step works |
| **Escape** | ✅ `onEscapeKeyDown` → `goBackSubView` | — |
| **Backspace (empty)** | ✅ `handleSubViewBackspace` + header hint `⌫ empty` | — |
| **Tab** | ⚠️ Back button before input in DOM order | ❌ Back is `<button>` — Tab order awkward vs search field |
| **Wrap** | ❌ `loop={false}` | ❌ No wrap at first/last channel |
| **Multi-pick stay-open** | ✅ `closeOnPick: false` on select/deselect/freeze/unfreeze/auto-follow | ⚠️ No toast/hint that palette stayed open; **Enter again** should work — manual only |
| **Confirm chain** | ✅ delete/reset-sync/clear-db-table → `openConfirm` after pick | ⚠️ Keyboard path entity → confirm untested E2E |
| **Mouse-only Back** | ⚠️ Header Back button | ❌ No `Alt+←` / dedicated shortcut (Escape/Backspace only) |

**Flows to verify:** `select-channel`, `deselect-channel`, `freeze-channel`, `unfreeze-channel`, `toggle-auto-follow`, `sync-channel`, `delete-channel`, `reset-sync-channel`, `add-tag-channel` (entity→editor), `remove-tag-channel` (entity→tag-pick), `delete-summary`, `pick-post`, `clear-db-table`, `search-channel`.

### `editor` (free-form settings, add channel, search query)

| Interaction | Today | Gap |
|-------------|-------|-----|
| **Initial focus** | ✅ input/textarea rAF | — |
| **Type** | ✅ Controlled `editorValue`; init on `editorCommand.id` only (reset bug fixed) | — |
| **Enter** | ✅ Single-line: Enter applies; textarea: `Cmd/Ctrl+Enter` applies | ⚠️ No footer hint for textarea shortcut |
| **Shift+Enter** | ⚠️ textarea: default newline | ✅ OK for multi-line proxy URLs |
| **Escape** | ✅ Pops stack via dialog handler | ⚠️ Discards in-progress edit without confirm (acceptable; match VS Code) |
| **Backspace (empty)** | ✅ Pops to parent | ⚠️ No header hint (entity/search have `⌫ empty`) |
| **Tab** | ✅ Normal field behavior | ❌ Apply button after field — Tab reaches it but **Enter on Apply button** not needed if field Enter works |
| **Apply button** | ⚠️ Mouse-oriented `<button>` | ❌ Not focused after open; no `data-testid` for keyboard E2E |
| **Stay-open** | ✅ `closeOnApply: false` (add-channel, semantic search editor) | ⚠️ After Enter apply, refocus field — works; **chained** add-tag editor path needs focus verify |
| **Search → results** | ✅ Enter on search posts/summaries opens `search-results` | ⚠️ Async semantic search — no loading keyboard state |

### `search-results` (in-palette post/summary pick list)

| Interaction | Today | Gap |
|-------------|-------|-----|
| **Initial focus** | ✅ `searchResultsInputRef` | — |
| **Type-to-filter** | ✅ `searchResultsQuery` filters capped items in memory | — |
| **↑/↓ navigate** | ⚠️ cmdk default | ❌ **No controlled selection** (desync risk) |
| **Enter** | ✅ Pick → navigate tab + close palette | — |
| **Escape / Backspace** | ✅ Pop to editor; preserves query in `editorValue` | — |
| **Wrap** | ❌ `loop={false}` | ❌ |
| **Empty results** | ✅ `CommandEmpty` copy | — |
| **Header Back** | ⚠️ Mouse button | Same as entity |

### `confirm` (destructive / import guard)

| Interaction | Today | Gap |
|-------------|-------|-----|
| **Initial focus** | ❌ Unknown / dialog default | ❌ **No autofocus** on Cancel or Confirm |
| **Enter** | ❌ Not wired | ❌ **Enter does nothing** — major gap vs VS Code/Raycast |
| **Escape** | ✅ Pops to parent (cancel) | — |
| **↑/↓ or ←/→** | ❌ | ❌ No keyboard move between Cancel / Confirm |
| **Tab** | ⚠️ Cycles two buttons + dialog close | ⚠️ Destructive default should be explicit policy |
| **Confirm → file picker** | ⚠️ Import commands open native picker on confirm | ❌ **Cannot complete import keyboard-only** (browser limitation — document + optional fallback) |
| **Mouse-only** | ❌ Buttons only | — |

**Flows:** bulk freeze/unfreeze, clear cache, import/export DB, delete channel, delete summary, reset-sync, delete selected, bulk reset, clear IndexedDB table, migrate.

### `assistant` (stub)

| Interaction | Today | Gap |
|-------------|-------|-----|
| **Escape / Backspace** | ✅ Pop to commands | — |
| **Back button** | ⚠️ Mouse only | ❌ Not keyboard-first |
| **Any action** | N/A stub | Low priority until NL ships |

### Cross-cutting / chained flows

| Flow | Keyboard today | Gap |
|------|----------------|-----|
| **Add channel** | editor → Enter → stay open | ⚠️ E2E clicks Apply; no keyboard-only test |
| **Add tag** | entity pick → editor → Enter → close | ❌ Full chain untested keyboard-only |
| **Remove tag** | entity → tag-pick → Enter → close | ❌ Tag-pick sub-view focus after chain |
| **Delete channel** | entity → Enter → confirm | ⚠️ Partial E2E (clicks); confirm step not keyboard |
| **Import channels** | commands → confirm → **native file dialog** | ❌ Inherently mouse-heavy post-confirm |
| **Search posts** | editor Enter → search-results → Enter pick | ⚠️ E2E clicks Apply |
| **Semantic search** | Same + async wait | ❌ No keyboard loading/disabled state |
| **Multi-pick** | Repeated Enter on entity list | ⚠️ Selection state updates but no a11y live region |

### Recent bug fixes (baseline — do not regress)

- Entity sub-view input focus (`requestAnimationFrame`)
- Editor value reset (`editorCommand.id` dep only, not full context)
- Enter to apply on single-line editor
- Commands mode arrow/hover desync (`selectedCommandId` control)
- `closeOnPick: false` for deselect multi-pick
- Query reset on open uses stable `refreshJobStatus` only

---

## 2. Principles — target conventions (Raycast / VS Code)

| Principle | Target behavior | Default for TG Summarizer |
|-----------|-----------------|---------------------------|
| **Type to filter** | Input always focused on sub-view open; typing never requires click | Keep current rAF focus |
| **↑/↓** | Move selection; **wrap** at ends | Enable `loop={true}` on all cmdk list modes |
| **Enter** | Execute highlighted item / apply editor / confirm default action | Confirm: Enter on **Confirm** for destructive (VS Code style: Enter runs highlighted) |
| **Escape** | One level back in stack; close palette at root | Keep `onEscapeKeyDown` + root close |
| **Backspace (empty input)** | Pop one stack level | Keep; show hint on **all** sub-views |
| **Disabled rows** | Visible, skipped by arrows, **not** runnable via Enter | Rely on cmdk + add tests |
| **Stay-open flows** | After pick/apply, refocus filter input; clear sub-query | Keep `closeOnPick`/`closeOnApply` semantics |
| **Confirm destructive** | Focus **Cancel** by default; Enter on focused button; optional `Cmd+Enter` → Confirm | **Default: focus Cancel** (safer for delete) — user can Tab to Confirm |
| **Hints** | Subtle footer shortcuts | `↵ run` `esc back` `⌫ parent` — entity/search already show partial |
| **No mouse required** | Every flow completable from open shortcut to close | Except native file picker after import confirm |
| **Tab** | Trap within palette; don't escape to page behind | Audit Radix trap; prevent focus on X when in list mode |

---

## 3. Command inventory of UX fixes

Grouped **interaction fixes** (not new commands). Each item is a checklist row for implementation.

### A. Shared infrastructure

- [x] **`usePaletteListSelection` hook** — controlled cmdk `value`/`onValueChange`, reset selection to first navigable item on filter change, shared by `commands` | `entity` | `search-results`
- [x] **`PaletteSubViewHeader`** — keyboard-accessible Back (`type="button"`, visible focus ring), optional `⌫ empty` hint, `aria-label`
- [x] **`PaletteFooterHints`** — mode-aware shortcut legend (root: `↵` / `esc`; editor: `↵ apply` / `⌃↵` textarea; confirm: `esc cancel`)
- [x] **Enable `loop={true}`** on all three cmdk instances
- [x] **Tab policy** — `onOpenAutoFocus` prevent default + manual input focus; optionally `tabIndex={-1}` on dialog close button while list modes active
- [x] **`data-testid` hooks** — `command-palette-editor-apply`, `command-palette-confirm-cancel`, `command-palette-confirm-confirm`, entity/search first item

### B. `commands` mode

- [x] Verify arrow navigation across **Recent** + **grouped** sections with wrap
- [x] Verify **Enter** does not run **disabled** commands (offline sync, empty selection, etc.)
- [x] Verify **Enter** on `editor`/`entity-root`/`assistant` kinds opens sub-view without mouse
- [x] Optional: **Cmd+Enter** as alias for Enter on root (low priority)

### C. `entity` mode

- [x] Apply controlled selection (fix hover/arrow desync)
- [x] Reset selection to first candidate when `entityQuery` changes (mirror `commandListRef.scrollTo`)
- [x] After **multi-pick** Enter: assert input refocus + query cleared
- [ ] **Chained flows** keyboard checklist:
  - [x] Add tag: channel pick → editor → Enter → close
  - [x] Remove tag: channel pick → tag pick → Enter → close
  - [x] Delete / reset-sync: channel pick → confirm keyboard complete
  - [x] Clear DB table: table pick → confirm
- [x] **delete-summary** / **pick-post** / **clear-db-table** — selection + Enter on non-channel entities

### D. `editor` mode

- [x] Footer hint: `Enter` apply; textarea `⌘↵` / `Ctrl+↵`
- [x] `data-testid="command-palette-editor-apply"` on Apply button
- [x] **Enter** on empty add-channel → no-op (existing) — `CommandPalette.tsx:509-514`
- [x] **stay-open** add-channel: Enter → field cleared → still focused
- [x] **Chained editor** (add-tag, edit-start-id): focus editor input after entity pick
- [x] **Async search** (semantic): disable Enter / show loading row while `semanticSearchPostsForPalette` pending

### E. `search-results` mode

- [x] Controlled selection + wrap
- [x] Enter pick closes palette and navigates (posts/summaries)
- [x] Filter input + arrows work together (type then ↓ without mouse)
- [x] Back to editor preserves query (existing) — keyboard regression test

### F. `confirm` mode

- [x] **Autofocus Cancel** on mount (safer default)
- [x] **Enter** activates focused button
- [x] **←/→** or **↑/↓** moves between Cancel / Confirm
- [x] **Escape** = Cancel (existing via pop)
- [x] `data-testid` on both buttons (partial — container exists)
- [x] Document: **import** confirm → native file picker requires manual file selection (acceptable exception)

### G. `assistant` stub

- [ ] Back control keyboard reachable (Tab or treat as low priority until feature ships)

### H. Chained / multi-step flows (end-to-end keyboard)

| Flow | Fix focus |
|------|-----------|
| Select 3 channels (stay-open) | 3× Enter, verify selection count |
| Deselect 2 channels | Same |
| Freeze → unfreeze same channel | Two commands, keyboard each |
| Add channel ×2 stay-open | Two Enter applies |
| Search posts → pick → posts tab | Full keyboard |
| Delete channel → confirm → cancel | Escape or Cancel keyboard |
| Import → confirm → (file picker) | Document exception |
| Toggle theme from root | Type + Enter only test |
| Export selected | Type + Enter (no confirm) |
| Add tag → editor → Enter | K12 keyboard chain |
| Remove tag → tag-pick → Enter | K13 keyboard chain |
| Search-results Backspace → editor query | K14 regression |

---

## 4. Phasing

### Phase 1 — Quick wins (1–2 sessions)

High impact, localized changes:

1. **Confirm dialog keyboard** — autofocus, Enter, arrow between buttons
2. **`loop={true}`** on all cmdk lists
3. **Footer hints** on editor + confirm (match entity/search header)
4. **`data-testid`** on editor Apply + confirm buttons
5. **Playwright: 3 keyboard-only smokes** — open shortcut, navigate tab via type+Enter, toggle theme via type+Enter

### Phase 2 — Selection parity (structural)

1. **`usePaletteListSelection`** — extend commands pattern to entity + search-results
2. **Disabled row regression** — unit or E2E for offline-disabled Enter
3. **Multi-pick refocus** — explicit test for select/deselect stay-open
4. **Tab / focus trap audit** — prevent close-button focus steal

### Phase 3 — Chained flows + coverage

1. Keyboard E2E for: delete confirm chain, search-results pick, add-channel stay-open
2. Chained add-tag / remove-tag keyboard paths
3. Semantic search loading state (keyboard blocked while pending)
4. **Manual matrix** (below) run once before ship
5. Optional: `aria-live` polite announcement on multi-pick ("Channel selected, palette open")

### Deferred (out of scope)

- Full WAI-ARIA combobox audit for whole app
- Import file picker keyboard alternative (hidden `<input type="file">` + paste path — not viable)
- NL assistant keyboard UX until feature exists
- `Cmd+K` shortcut (rejected per IDEA-001)

---

## 5. Files to touch

| File | Changes |
|------|---------|
| [`frontend/src/components/CommandPalette.tsx`](frontend/src/components/CommandPalette.tsx) | Controlled selection entity/search; loop; hints; confirm focus; async loading |
| [`frontend/src/components/CommandConfirmDialog.tsx`](frontend/src/components/CommandConfirmDialog.tsx) | Keyboard handlers, autofocus, button refs, testids |
| [`frontend/src/components/ui/command.tsx`](frontend/src/components/ui/command.tsx) | Only if cmdk props need wrapper defaults |
| [`frontend/src/hooks/usePaletteListSelection.ts`](frontend/src/hooks/usePaletteListSelection.ts) | **New** — shared selection + first-item reset |
| [`frontend/src/hooks/useCommandPalette.ts`](frontend/src/hooks/useCommandPalette.ts) | Unlikely; shortcut already correct |
| [`frontend/src/components/CommandPaletteProvider.tsx`](frontend/src/components/CommandPaletteProvider.tsx) | Unlikely; mode stack OK |
| [`frontend/src/lib/commands/types.ts`](frontend/src/lib/commands/types.ts) | Optional `keyboardHint` on `CommandDef` — probably YAGNI |
| [`frontend/tests/summarizer.spec.ts`](frontend/tests/summarizer.spec.ts) | Keyboard-only test suite |
| [`docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md`](docs/ideas-log/ideas/IDEA-007-command-palette-keyboard-ux.md) | Stub |
| [`docs/ideas-log/IDEAS-LOG.md`](docs/ideas-log/IDEAS-LOG.md) | Backlog row for IDEA-007 |
| [`MEMORY.md`](MEMORY.md) | After implementation — palette keyboard section |

**No changes** to command registry schemas, `closeOnPick`/`closeOnApply` flags, or individual command `run` handlers unless a specific flow blocks keyboard completion.

---

## 6. Test plan

### Playwright — keyboard-only flows (`summarizer.spec.ts`)

Use `page.keyboard` + `getByRole('option')` — **no `.click()`** on palette items except initial page setup.

| # | Test | Keys | Assert |
|---|------|------|--------|
| K1 | Open/close | `Meta/Ctrl+Shift+P`, `Escape` | Palette visibility |
| K2 | Navigate tab | Open → type `channels` → `Enter` on highlighted | URL `tab=channels` |
| K3 | Toggle theme | Open → type `toggle theme` → `Enter` | `html.dark` toggled |
| K4 | Entity pick | Open → `sync channel` → `Enter` → type filter → `ArrowDown` → `Enter` | Sync queued / toast |
| K5 | Multi-pick | `select channel` → pick 2 channels via `Enter` ×2 | 2 selected; palette open |
| K6 | Editor apply | `add channel` → type handle → `Enter` | Channel added; palette open |
| K7 | Search results | `search posts` → type query → `Enter` → `ArrowDown` → `Enter` | Posts tab active |
| K8 | Confirm cancel | `delete channel` → pick → `Escape` | Confirm dismissed; channel exists |
| K9 | Confirm proceed | `clear cache` or mock-safe confirm → Tab to Confirm → `Enter` | Action runs (or cancel variant) |
| K10 | Backspace back | Entity view → `Backspace` on empty filter | Root list visible |
| K11 | Disabled skip | Offline mock → `sync all` → arrows skip disabled | Enter does not sync |
| K12 | Add tag chain | `add tag` → channel → tag → `Enter` | Tag on channel (API + UI) |
| K13 | Remove tag chain | `remove tag` → channel → tag pick → `Enter` | Tag removed |
| K14 | Search-results back | `search posts` → results → `Backspace` on empty filter | Editor keeps query |
| K15 | Clear IndexedDB table cancel | `clear indexeddb` → pick table → `Escape` on confirm | Confirm dismissed; entity view |
| K16 | Deselect multi-pick | `deselect channel` → 2× `Enter` | Channels deselected |
| K17 | Freeze → unfreeze | `freeze channel` → pick → `unfreeze channel` → pick | Frozen status toggled |

### Manual keyboard matrix

Run with trackpad disabled / mouse unplugged.

| Mode | Keys to exercise | Pass criteria |
|------|------------------|---------------|
| Root | Type, ↑↓ wrap, Enter, Esc | Command runs; disabled skipped |
| Entity | Filter, ↑↓, Enter×N, ⌫, Esc | Multi-pick works; back to root |
| Editor | Type, Enter, ⌫, Esc, ⌘↵ textarea | Apply works; back preserves parent |
| Search-results | Filter, ↑↓, Enter, ⌫ | Pick navigates; back to editor |
| Confirm | Tab, ←→, Enter, Esc | Cancel/confirm without mouse |
| Chains | Full add-tag, remove-tag, delete | No focus trap dead ends |

### Regression guards

- Do not reintroduce `jobToggles` identity in open-reset effect
- Editor value must not reset mid-typing on context refresh
- Entity focus on mode transition (rAF)

---

## 7. Open questions

| # | Question | Proposed default |
|---|----------|------------------|
| Q1 | Confirm **Enter** → Confirm or Cancel when Confirm focused? | **Focused button wins**; default focus **Cancel** |
| Q2 | Destructive confirm: allow `Cmd+Enter` to confirm from Cancel focus? | **No** v1 — reduces accidental delete |
| Q3 | Enable list **wrap** (`loop={true}`)? | **Yes** — match Raycast/VS Code |
| Q4 | Import after confirm — accept native file picker as keyboard exception? | **Yes** — document in hints |
| Q5 | `aria-live` on multi-pick stay-open? | **Phase 3 optional** — skip unless user wants screen reader polish |
| Q6 | Hide dialog **X** close button from tab order in list modes? | **Yes** if audit shows focus steal |

No blocking questions — defaults above are sufficient to implement.

---

## References

- [`CommandPalette.tsx`](frontend/src/components/CommandPalette.tsx) — all modes
- [`CommandPaletteProvider.tsx`](frontend/src/components/CommandPaletteProvider.tsx) — mode stack
- [`command.tsx`](frontend/src/components/ui/command.tsx) — cmdk wrapper
- [`types.ts`](frontend/src/lib/commands/types.ts) — `closeOnPick`, `closeOnApply`, `PaletteMode`
- [IDEA-001 plan](command_palette_implementation_ad418199.plan.md) — original keyboard back spec
- [IDEA-005 plan](command_palette_channel_ops_search.plan.md) — search-results mode
- MEMORY.md — palette bugs fixed 2026-06-23/24
