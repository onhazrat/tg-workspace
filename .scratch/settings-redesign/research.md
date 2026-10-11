# Settings redesign: research and learnings

Status: needs-triage

What we learned before and while prototyping the workspace Settings tab
(2026-10-11). The prototype itself, round by round, is in `prototype.md`; this
file is the reasoning a fold-in should start from.

## 1. What Settings is today

Two separate surfaces:

- `/settings` (`routes/_layout/settings.tsx`) is the leftover template page:
  Profile, Password, Usage, Danger zone. Its browser title still says
  "Settings - FastAPI Template". `/admin` (Users, Quotas) is the same template
  shell.
- `/workspace?tab=settings` (`SettingsHub.tsx`) is the real hub: a 22-node tree
  (`lib/settings/toc.ts`) with 8 top-level groups, a search box with
  `@modified`, `@feature:` and `@id:` filters, and `?setting=` deep links.

Values live in three stores, and the UI shows none of this:

| Store | Examples | Who writes it |
|---|---|---|
| This browser (`scopedStorage`) | theme, the 8 `showChannel*` card toggles, Discover weights, focus mode, AI model / language / temperature | you |
| Your account (`tg_user_settings`) | publishing style, log/report retention, sync prefs | you |
| The deployment (`tg_app_settings`) | sync interval and backoff, post retention, translation, reach, network/Tor, embeddings job | Admin |

### Code problems

1. **Non-Admins can edit deployment settings and nothing tells them.** No
   settings component checks permissions. The value is kept in the browser, the
   server answers 403, and `store.ts` swallows it on purpose, so the control
   shows a value the server never accepted. `useCanManageJobs()` is the
   client's only Admin signal.
2. **Every change saves at once, undebounced.** Each backend section has its
   own `useEffect` in `SettingsContext.tsx` that sends the whole section on
   every change; typing `120` sends three requests. Failures go to
   `console.warn` (reach shows a toast). Bots, destinations and proxies use an
   explicit Save, so one page mixes two save models.
3. **Metadata is defined twice.** `catalog.ts` (70 entries) drives search,
   Commonly Used, palette commands and `SyncSection`, but `AiSection`,
   `AppearanceSection`, `RetentionPanel` and the network panels draw their own
   controls with their own labels, so a setting looks different in search than
   in its section.
4. **One new setting touches four or five files**: `schema.ts`, the
   hand-typed 60-field `SettingsContextType`, `catalog.ts`, the section, and
   sometimes the command schema.
5. **Each section is defined in about six maps** (`SETTINGS_TOC`,
   `SETTINGS_SECTION_CONTENT`, `HEADINGS`, `SETTINGS_VIEW_BODIES`,
   `GROUP_SECTIONS`, the DB-stats and terminal-theme sets).
6. **About a third of the tree is tools, not settings**: Diagnostics, Network
   telemetry, Configuration catalog, Query console, Table sizes, Import/export,
   Quick message.

### Style problems

- 10px uppercase wide-tracked labels and 9-10px italic serif subtitles: hard
  to scan.
- Three layouts in one page: catalog rows, two-column card shells, bespoke
  panels. Some sections switch to a terminal theme; a header reads
  `[CHANNELS-SYNC]` in mono.

## 2. What the best projects do

**VS Code**
- One registry drives the UI (`contributes.configuration`): type, default,
  markdown description, enum labels, min/max, pattern + message, scope, order,
  tags, `ignoreSync`, deprecation. Every row is generated.
- Layout is separate from the schema: `settingsLayout.ts` places settings by
  pattern (`'editor.font*'`) and lists the Commonly Used ids.
- Scope is built in: User/Workspace tabs and per-row indicators ("Managed by
  organization", "Modified in", "Also modified in", "Not synced", "Applies to
  all profiles", "Default value changed").
- Filters `@tag:` and `@haspolicy`; the row gear menu has reset, copy ID, copy
  JSON pair, copy settings URL.
- Nested dotted ids (`workbench.settings.openDefaultKeybindings`) are the
  public address of a setting.

**Zed** rebuilt its settings UI in 2025. Generating it from metadata with
macros failed on dependency tangles, so they hand-wrote it with helpers. What
they kept: one typed schema, with scope (user vs project) organising both UI
and code. Lesson: generate the plain rows, hand-write the real panels.

**GitLab Pajamas**: never mix auto-save and a Save button in one form; when a
setting is locked by a role or parent, say why; tools that behave like a small
app are not settings; a "Configure in settings" link next to a feature.

**Home Assistant** is removing its global "Advanced mode" (deprecated 2026,
removed 2027.6): one switch hid unrelated things, so options moved next to each
feature.

**Mattermost** keeps the Admin System Console (one `AdminDefinition` object)
apart from each user's account settings.

Sources: [VS Code settings](https://code.visualstudio.com/docs/configure/settings),
[contribution points](https://code.visualstudio.com/api/references/contribution-points),
[settingsLayout.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/preferences/browser/settingsLayout.ts),
[settingsEditorSettingIndicators.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/preferences/browser/settingsEditorSettingIndicators.ts),
[Zed: settings UI](https://zed.dev/blog/settings-ui),
[Pajamas settings management](https://design.gitlab.com/patterns/settings-management),
[GitLab settings exploration](https://gitlab.com/gitlab-org/gitlab/-/issues/275969),
[GitLab settings redesign](https://about.gitlab.com/blog/quantifying-ux-validating-the-redesign-of-gitlabs-settings-pages/),
[Home Assistant advanced mode](https://developers.home-assistant.io/blog/2026/05/26/advanced-mode-config-flow-deprecation),
[Mattermost System Console](https://docs.mattermost.com/developers/contribute/more-info/server/system_console).

## 3. Recommendations (validated by the prototype unless noted)

1. **Scope first.** Every row says where it lives: This browser, My account,
   Deployment; "Managed by Admin" with a lock when the account cannot write.
   Fixes code problem 1.
2. **One registry, served by the backend.** Each settings row is a pydantic
   model; the frontend draws plain rows from its JSON Schema and keeps only a
   layout (patterns per group). Hand-write only the true panels: AI keys, bots,
   destinations, proxies, Tor, setting groups, jobs. The server validates every
   write, so bounds live in one place.
3. **Nested ids as the address** (variant E): `sync.schedule.intervalMinutes`,
   `appearance.channelCard.showBio`. The layout selects by id prefix, the
   second segment is a sub-heading, and search, `?setting=` deep links and
   "Copy link to setting" use the id. Storage keys stay as they are ("stored
   as `sync.regularSyncIntervalMinutes`"), so no migration is needed.
4. **Tools leave Settings** for a System tab. Logs (an account's own) and Quick
   message are for everyone; Network telemetry, Database, Query console and
   Import/export are Admin only.
5. **One home.** `/settings` and `/admin` content (Profile, Password, Usage,
   Delete account, Users, Quotas) becomes Account and Admin pages inside the
   workspace Settings tab, and the workspace becomes `/`. See `prototype.md`
   round 3 for what `_tg` must take over first (approval redirect,
   `syncServerClock`, `QuotaWarning`).
6. **One save model per kind of control.** Plain fields auto-save (numbers
   600ms after typing stops) and show Saved / the server's error on the row;
   credentials and proxies keep an explicit Save.
7. **Modified counts per group**, and a "Modified only" filter.

## 4. Configuration (`.env`) values

The Configuration catalog is generated: every `Settings` field in `config.py`
(119), plus compose and tooling variables from `env_catalog.generated.json`,
plus `GLOBAL_KEYS` / `USER_KEYS`, quota override rows and `VITE_*` entries. Its
weak part is the text: every deployment entry has the same boilerplate line.

The 119 values are three kinds:

1. **Bootstrap and secrets, never editable from the UI**: `POSTGRES_*`,
   `SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, `API_KEY`, `SMTP_PASSWORD`,
   `FIRST_SUPERUSER*`, `BACKEND_CORS_ORIGINS`, `ENVIRONMENT`. Some are needed
   before the database is reachable, and a UI that rewrites `SECRET_KEY` turns
   a stolen Admin session into owning the deployment.
2. **Startup wiring**: `DB_POOL_SIZE`, `SYNC_QUEUE_*`, `*_JOB_INTERVAL_SECONDS`,
   `TENANCY_ENFORCED`, and so on. Making them live means rebuilding pools,
   APScheduler triggers or proxy semaphores in two processes. Rarely worth it.
3. **Policy knobs, which should be editable**, on the existing pattern
   (settings row, then `config.py`, then code default, as
   `resolve_budget_limits` does; the worker reads rows while it runs). Clear
   candidates: `USERS_OPEN_REGISTRATION`, `USERS_REQUIRE_APPROVAL`,
   `SYNC_JOB_RETENTION_DAYS`, the `VIEW_AS_*_MINUTES` ceilings,
   `ACCESS_TOKEN_EXPIRE_MINUTES`, `SLOW_REQUEST_LOG_MS`. The `*_DEFAULT`
   variables are already starting values for rows the UI edits.

Prototype decisions: policy knobs become rows in their group; a seed shows in
the row it seeds ("default X from KEY"); everything else is read-only under its
group, Admin only. **Secrets show only "set" or "not set", even to Admins**: the
value is never needed to operate the app, and showing it puts it in screen
shares, screenshots, browser memory and any XSS's reach, and makes a read-only
Admin session as dangerous as a shell. Rotation stays an `.env` change.

## 5. Things found along the way

- **`embeddingsPaused` is dead.** It is browser-only and nothing reads it; the
  real switch is the deployment's `jobs.embeddingsEnabled`. Delete it.
- **Frontend and backend defaults drift.** `schema.ts` restates defaults the
  backend also owns, and some disagree; writing the pydantic rows meant
  correcting several by hand. One served schema removes the second copy.
- **AI model, language and temperature are browser-only** today, so they do not
  follow an account across devices. The prototype moved them to the account.
- **`/workspace` lacks the approval redirect and `QuotaWarning`** that the
  template shell has (details in `prototype.md` round 3).
- **Admin → Users looks foreign** because it is the template's shadcn admin
  screen, unchanged: stock `muted-foreground` tokens, a boxed `DataTable`,
  Title Case ("Full Name", "Add User"), a floating filled button with a
  hard-coded `my-4`, and "Superuser" from `is_superuser`, which access no
  longer reads (roles live in `rbac_user_roles`; `UserPublic` carries none).
  Profile, Password and Quotas have the same problem to a lesser degree.

## 6. Styling: Settings against the rest of the workspace

E still looks like a different app from Channels, Posts and Action. It breaks
out of the tab padding with a full-height grey sidebar (no other tab has one),
uses text-lg page headings, Title-Case outline chips, a square search box, flat
rows with 13px help text, and the old settings fields (tall `p-3` mono inputs,
all-caps segments, raw enum values such as `ASWRITTEN`).

The other tabs' primitives, to reuse in a restyle:

- Panel shell: `rounded-xl border border-app-ink/10 bg-app-card shadow-sm`,
  header strip `border-b bg-app-muted/20 p-4` (`ActionView.tsx`).
- Rows: `ActionRow` (`components/action/ActionRow.tsx`), a fixed three-column
  grid so every control lands in one column; icon tile, `text-sm font-bold`
  title, 11px description.
- Toolbar: muted `TgInput` at `h-9`, `Pill` / `Options` / `pillClass` from
  `PostFilterParts.tsx` ("Label value" pills), `TgSegmentedControl`, the count
  line under it (`ChannelGrid.tsx`).
- Micro-labels: 10px bold uppercase `tracking-widest` (Action's "Runs over").
- Chips: `TgMetaChip`, `TgFilterChip` (`components/ui/tg-chips.tsx`).
- Segments in sentence case: `ACTION_SWITCH_OPTION_CLASS`.

Three restyles were built (stacked panels, a navigation panel with one group at
a time, compact two-column cards with panels in a sheet) and then dropped
without a verdict; they are in commit 708da088 (`app-skins.tsx`). Whatever
direction wins, the production panels and the Account/Admin page bodies need
the same restyle, or they stay the odd ones out.

## Open questions

- Does the backend facade split the frontend's single `retention` push into the
  deployment row and the per-account row correctly? The scope split depends on
  it; not checked.
- Do nested ids become the public settings address (URLs, search, docs)? That
  fixes the format before any fold-in.
- Which styling direction for E: keep the sidebar, or move into the
  workspace's panel-and-toolbar language?
