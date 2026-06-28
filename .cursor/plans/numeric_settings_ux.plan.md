---
name: Numeric Settings UX
overview: Replace coarse sliders and fixed retention day selects with precise number inputs, align retention defaults (90/30) across env and UI, and extend the command palette with two-step numeric editors and current-value badges. Status — implemented.
todos:
  - id: retention-rules
    content: Retention — any non-negative integer; 0 shows "Never" badge; number inputs in Settings and palette
    status: completed
  - id: replace-sliders
    content: Replace sliders/selects with number inputs in SettingsView, DatabaseManagement, ChannelGrid
    status: completed
  - id: palette-numeric-editors
    content: Command palette two-step editor flow + current value badges on all numeric editors
    status: completed
  - id: backend-get-merge
    content: GET /data/settings/{key} merges defaults for retention, sync, translation, jobs
    status: completed
  - id: frontend-retention-defaults
    content: Frontend retention defaults via VITE_RETENTION_* env vars (90/30)
    status: completed
  - id: tests
    content: settings-schema.test.ts (8) + test_settings_defaults.py (4)
    status: completed
isProject: false
---

# Numeric Settings UX — Plan

> Created: 2026-06-28 | Status: **Implemented**

---

## 1. Executive Summary

Numeric tunables (retention days, auto-sync interval, Tor rotation threshold, AI temperature, translation debounce, etc.) were edited via sliders or small fixed option lists. That made precise values awkward and retention `0` ("never purge") easy to miss. This work standardizes on **number inputs** in the main settings UI and a **two-step command palette flow** (pick setting → edit value) with **current-value badges**, merges **server-side defaults** on `GET /data/settings/{key}`, and aligns **frontend retention defaults** with backend via `VITE_RETENTION_*`.

---

## 2. Scope

**In scope**

- Retention: any non-negative integer; `0` = never (UI badge **Never**)
- Settings surfaces: `SettingsView`, `DatabaseManagement`, `ChannelGrid` (where numeric job/sync controls appear)
- Command palette: `settings-schema.ts` numeric editor definitions, badges, clamping
- API: default merge for `retention`, `sync`, `translation`, `jobs` keys
- Env: `.env.example` + `frontend/src/lib/env.ts` for `VITE_RETENTION_POST_DAYS_DEFAULT` / `VITE_RETENTION_LOG_DAYS_DEFAULT`
- Unit/API tests for schema builders and GET settings merge

**Out of scope**

- Redesign of non-numeric settings (booleans, enums, text)
- `SettingsView.tsx` structural refactor (still deferred per MEMORY)
- Changing backend retention job semantics beyond documented defaults merge

---

## 3. User decisions (locked)

| Topic | Decision |
|-------|----------|
| Retention values | Any non-negative **integer**; `0` means never purge |
| Retention UI | Number inputs; palette shows **Never** badge when value is `0` |
| Other numerics | Number inputs instead of sliders / fixed day selects where applicable |
| Defaults | Post retention **90** days, log retention **30** days (env-driven, mirrored FE/BE) |
| Command palette | Two-step editor (command → field); show **current value** on every numeric editor command |
| Missing DB rows | `GET /settings/{key}` returns merged defaults for structured keys (not empty partial objects) |

---

## 4. Implementation phases (completed)

### Phase A — Schema and palette

- Remove fixed `RETENTION_DAY_OPTIONS` select commands
- Add `NUMERIC_EDITOR_DEFS`, `clampInt` / `clampFloat`, `formatRetentionBadge`
- Two-step flow: list command opens editor sub-view with min/max/step validation
- Badges on all numeric editor commands reflecting live settings slice

### Phase B — Settings UI

- `SettingsView`: retention, auto-sync interval, Tor threshold, AI temperature → `<input type="number">` with inline range hints
- `DatabaseManagement`: retention / related numeric controls aligned with same pattern
- `ChannelGrid`: numeric controls updated where sync/job intervals appear

### Phase C — Defaults and API

- `SettingsContext` + `constants.ts`: default retention from env-backed constants
- `backend/app/api/routes/data.py`: `_SETTING_LOADERS` for `retention`, `sync`, `translation`, `jobs` on GET
- `.env.example`: document `VITE_RETENTION_POST_DAYS_DEFAULT` / `VITE_RETENTION_LOG_DAYS_DEFAULT`

### Phase D — Tests

- `frontend/src/lib/commands/settings-schema.test.ts` — 8 tests (defs, badges, build commands)
- `backend/tests/api/test_settings_defaults.py` — 4 tests (GET merge per key)

---

## 5. Files changed

| Area | Files |
|------|--------|
| Backend API | `backend/app/api/routes/data.py` |
| Backend tests | `backend/tests/api/test_settings_defaults.py` |
| Frontend UI | `frontend/src/components/SettingsView.tsx`, `DatabaseManagement.tsx`, `ChannelGrid.tsx`, `CommandPalette.tsx` |
| Settings / env | `frontend/src/contexts/SettingsContext.tsx`, `frontend/src/constants.ts`, `frontend/src/lib/env.ts` |
| Command palette | `frontend/src/lib/commands/settings-schema.ts`, `types.ts`, `settings-schema.test.ts` |
| Docs / config | `.env.example`, `MEMORY.md` |

---

## 6. Test plan

**Automated**

- [ ] `cd frontend && bun test src/lib/commands/settings-schema.test.ts` — 8 passing
- [ ] `cd backend && uv run pytest tests/api/test_settings_defaults.py` — 4 passing

**Manual**

- [ ] Settings → retention: set `0` → label/badge shows **Never**; save/reload persists
- [ ] Settings → auto-sync interval: type `3` → clamps to min **5**; type `200` → clamps to **120**
- [ ] Command palette: open **Edit Post Retention** (or equivalent) → badge shows current days; apply new value → badge updates
- [ ] Fresh DB / cleared `AppSetting` row: `GET /api/v1/data/settings/retention` returns 90/30 (or env overrides)
- [ ] Database management retention fields match Settings behavior

---

## 7. Follow-ups (optional)

- E2E palette test for one numeric editor apply path (keyboard + badge)
- Document retention `0` semantics in operator-facing deployment docs if not already in `deployment.md`
