# Settings as one page on one registry: plan

Status: decisions settled (grilling, 2026-10-19); spec in `.scratch/settings-one-page/spec.md`; tickets SET-01 … SET-05 in `.scratch/settings-one-page/issues/`.

Turns prototype variant B (`prototype/settings-one-page`,
`.scratch/settings-one-page/prototype.md`) into the real Settings tab.
Architecture decision: `docs/migration/ADR-032-one-settings-registry.md`.
Vocabulary: Setting, Setting scope, Setting id, Configuration, Tools in
`CONTEXT.md`.

## Decisions

| # | Decision |
|---|---|
| 1 | A sequence of tickets, each its own PR to `main` (order below). |
| 2 | The backend serves the registry (`GET /api/v1/settings/registry`): account, deployment and Configuration rows with each row's permissions resolved; the frontend adds browser rows. |
| 3 | Code constants are shown, read-only, to holders of `settings:manage`, from a generated `constants_catalog.generated.json` (backend and frontend, comment and file:line), kept current by a pre-commit hook and a guard test. |
| 4 | Setting ids are the public address, declared explicitly, guarded (every stored field has exactly one id, no id twice). Old `?section=` links land on the matching topic. |
| 5 | `.env` is read-only in v1. Each knob that should be live (registration, approval, token lifetimes, View-as ceilings, job retention, slow-request log) becomes a runtime Setting in its own later ticket. |
| 6 | Secrets show only "set" or "not set", to everyone. |
| 7 | New Permission `settings:manage` (granted to the seeded Owner role): changes deployment Settings and reads Configuration. `data:admin` stays for the tools. |
| 8 | App at `/`: `/workspace`, `/summarizer`, `/settings`, `/admin` redirect; template shell deleted; `_tg` does the server-clock sync and the approval redirect; `QuotaWarning` lives in the workspace. |
| 9 | Tools tab: Logs and Quick message for everyone; Network telemetry, Table sizes, Import / export, Query console behind their permission. Restyling it is later. |
| 10 | Hard cutover per ticket, no flag: variant A, `SettingsHub`, `SettingsView`, `catalog.ts`, the settings tree in `toc.ts`, the section components, `ConfigurationCatalogView`, `/data/configuration`, the template `UserSettings` and `Admin` components. |
| 11 | Panel parity before the old panels go: bot and chat auto-lookup, bot Check, test message, Tor Test / Rotate (as actions on the Network topic), user edit / delete / View as / export as `BarPopover` forms and `TgConfirmDialog`. |
| 12 | The topic is **Operator** (`operator.*`), a lock reads "Set by the Operator"; scope labels This browser / Your account / Deployment / .env / Code; id segments `browser`, `yours`, `deployment`, `env`, `code`. |
| 13 | AI model, language and temperature move to the Account in this work. |
| 14 | A row's default is what it resets to, the next layer down resolved (account → deployment or `.env` seed → code), and the row says where it comes from. |
| 15 | One write door per Setting, `PUT /api/v1/settings/{settingId}`, validated by the registry; `SettingsContext` refetches the section after a write. Rebuilding `SettingsContext` on the registry is a later ticket. |
| 16 | One backend declaration per Setting next to `settings_registry.py` (id, title, description, type, bounds or choices, scope, visibility, permission, default source); browser Settings declared there too as `scope="browser"`. |
| 17 | The command palette builds its Settings commands from the registry: toggle / set per editable Setting, "Go to Settings → topic", jump to any Setting by id or title. |
| 18 | New per-Account key for AI preferences (`ai.yours.model`, `language`, `temperature`); on first load the browser uploads its values if the server has none, then stops storing them. Defaults from `DEFAULT_AI_MODEL` / `DEFAULT_AI_LANGUAGE`. |
| 19 | Every module-level numeric or boolean UPPER_CASE constant, with an explicit module → topic map a guard requires to cover every module, and a short exclusion list for unit conversions. |
| 20 | Each declaration says who can see it: every Account for what affects them (post retention, sync interval, translation, reach), `settings:manage` for infrastructure (network, jobs, media cache); unsure means `settings:manage`. |
| 21 | `VITE_*` build values are Configuration rows, "rebuild to apply", values read from the running bundle. |
| 22 | Plain rows save on Enter or blur; a refused write keeps the draft, turns the field red and shows the server's message under it; success shows "Saved" briefly. Panels keep explicit Save. No toast. |
| 23 | On phones a "Contents" pill in the sticky bar opens the tree in a `BarPopover`. |
| 24 | Quota defaults become six deployment Settings (`quota.deployment.autoSyncAllowance` …) defaulting to the `.env` values; per-Account overrides and usage stay panels under Operator. |
| 25 | No former ids: renaming a Setting id is allowed to break old links. |
| 26 | Search operators `@modified`, `@editable`, `@scope:…`, `@restart`, `@id:`; `@feature:` is dropped. |
| 27 | "Changed" counts a `.env` value that differs from the code literal, never a secret. |
| 28 | Folded topics in the contents are remembered per browser (`scopedStorage`). |
| 29 | No "Commonly used" section. |
| 30 | ADR-032 records the registry and the Setting id. |

## Tickets

Written as five tickets (fewest that each land green): SET-01 = 1–3 below, SET-02 = 4, 6, 8 (old panels embedded until SET-03), SET-03 = 7 and the template pages, SET-04 = 9, SET-05 = 5. SET-03, -04, -05 run in parallel after SET-02.

Original ordering, for reference:

1. **Shared primitives** (already built on the prototype branch): `TgInlineSegments`, `TgInlineChoice`, `TgTableCard`; the Directory, Action and Posts switches on them; then Discover's filter bar and Summary's reading controls.
2. **App at `/`** (decision 8), with the e2e specs that navigate to the old paths.
3. **Tools tab** (decision 9).
4. **Registry backend**: declarations (16, 20, 24), `GET /settings/registry`, `PUT /settings/{settingId}` (15), `settings:manage` (7), guards (4, 16).
5. **AI preferences on the Account** (13, 18).
6. **The Settings page on the registry**: rows, search (26), "Changed" (14, 27), contents tree with counts and remembered folding (28), phone Contents pill (23), row-level save state (22), the palette (17), `?section=` landing (4), Operator wording (12).
7. **Panels at parity** (11) and the Operator topic (users, quota overrides, usage).
8. **Cutover** (10): delete the old Settings, the catalog, `/data/configuration`, the template components; rewrite the Playwright specs for settings and admin.
9. **Configuration rows**: `.env` (5, 6, 21) and the generated constants catalog (3, 19).

Later, each its own ticket: `SettingsContext` on the registry; each live `.env` knob; Tools styled like the Settings page; retire `TgSegmentedControl`.
