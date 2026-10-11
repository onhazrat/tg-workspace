# Settings redesign prototype

Status: needs-triage

Verdict (2026-10-11): **A wins.** B (scope-first tabs) and C (overview + drawer)
were dropped and deleted from the branch; the earlier commit 3bfbaa14 still has them.

Question: what should the workspace Settings tab look like once scope (browser /
account / deployment) is first-class, tools leave it, and every plain setting
uses one row?

Code: `frontend/src/components/settings-prototype/` (throwaway), mounted on the
existing `?tab=settings` route through `App.tsx`; `?variant=` is a workspace
search param.

| Variant | Idea | Borrowed from |
|---|---|---|
| 0 | main, unchanged | |
| A | one scrolling list, scroll-spy tree, search + scope chips + "Modified only" | VS Code |
| B, C | dropped, see verdict | |

Shared: `model.ts` derives each setting's scope from where it is stored
(`schema.ts` section + the backend's SYNC_PREF_FIELDS / RETENTION_PREF_FIELDS);
`ProtoRow.tsx` is the one row (scope badge, "Managed by Admin" when the account
cannot write, modified bar, menu with reset / copy link / copy id, numbers commit
600ms after typing stops); `panels.tsx` frames the hand-written panels.

Admin is read from `useCanManageJobs()`, the client's only permission signal.

Writes are real: every variant saves through `SettingsContext`.

## Run

```
cd frontend
PLAYWRIGHT_API_URL=<deployment api base> \
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<tailnet host> \
bunx vite --port 5180 --strictPort --host 127.0.0.1
tailscale serve --bg --https=5180 http://127.0.0.1:5180
```

Open `/workspace?tab=settings&variant=A` and log in; the pink bar (or ← →) switches variants.

## Not covered

- `payloadRetentionDays` and the bulk re-sync button have no row in A/B/C.
- The "moved to System" tools are listed, not mounted anywhere new.

## Round 3: one home (2026-10-11)

Variant A's tree now also holds everything `/settings` and `/admin` had:
Account (Profile, Password, Usage, Activity logs, Delete account) and, for
Admins, Admin (Users, Quotas, Configuration, Network telemetry, Database,
Query console, Import / export). Quick message joined Publishing. Bodies are the
production components, unchanged (`pages.tsx`).

Not prototyped, because routing is app-wide and variant 0 must stay main.
This is the work left to fold in:

- `/` serves the workspace; `/workspace`, `/settings`, `/admin` redirect into
  it (`/settings` → Account → Profile, `/admin` → Admin → Users). Keep the old
  paths as redirects: bookmarks, e2e specs, emails.
- Delete the template shell (`routes/_layout.tsx`, `AppSidebar`, the Dashboard,
  the "FastAPI Template" titles).
- Its `beforeLoad` does two things `_tg` does not: the **approval redirect**
  (a pending account on `/workspace` gets 403s today, not the pending page)
  and the awaited `syncServerClock`. Move both into `_tg`.
- `QuotaWarning` renders only in the template shell, so it never shows in the
  workspace today. Give it a place in the workspace header.
- The Admin section must use a real permission read, not `useCanManageJobs()`.
- e2e: `admin.spec.ts`, `user-settings.spec.ts` navigate to the old paths.

## Round 4: variant B, generated from a backend schema (2026-10-11)

B is A's layout with every row drawn from JSON Schema served by a standalone
prototype API, `backend/scripts/proto_settings_api.py` (never mounted in the
real API). Each settings row is a pydantic model; a field carries its title,
description, default (from `config.py` where one exists), bounds, enum, and the
row carries scope (device / account / deployment) and store. The frontend keeps
only a layout (`LAYOUT` in `VariantB.tsx`, VS Code-style `"sync.*"` patterns),
plus the hand-written panels.

- Device rows (Appearance) are declared in the schema but stay in the browser.
- AI model, language and temperature moved from the browser to the account.
- `.env` policy knobs became rows: Access (`USERS_OPEN_REGISTRATION`,
  `USERS_REQUIRE_APPROVAL`), Sessions (token and View-as lifetimes),
  Housekeeping (`SYNC_JOB_RETENTION_DAYS`, `SLOW_REQUEST_LOG_MS`).
- Every write is validated by the server first (`POST /settings/{row}/validate`).
- Admin → Configuration lists all 119 `config.py` fields classified as editable
  (8), seed of an existing setting (24), read at startup (56), bootstrap (22) or
  secret (9), each with its reason.

Stores: `browser` and `server` rows write through `SettingsContext`, as today
(real writes). `proto` rows (AI prefs, the new knobs) go to
`proto.settings_overrides` on the deployment's scratch schema; **the live app
never reads them**, so flipping "Open registration" changes nothing yet.

Run the API (needs the DB tunnel on :5433 and `~/.pgpass`):

```
cd backend
PROTO_DSN="host=localhost port=5433 dbname=app user=<role>" \
PROTO_API_BASE=<deployment api base> PROTO_PORT=8030 \
uv run python scripts/proto_settings_api.py
```

and start Vite with `PROTO_API_PORT=8030` so `/proto` is proxied.

Found while building it: frontend and backend defaults already disagree in
places (the frontend schema guessed some), which is the drift a single schema
removes.

## Round 5: variant C, Configuration merged into Settings (2026-10-11)

C is B with `merged` on (`VariantB.tsx`); the separate Configuration page is
gone. Every `config.py` field now lives in a Settings group:

- policy knobs (8) are rows, as in B;
- seeds (10 mapped via `SEED_OF`) are folded into the row they seed: the row
  says where its default comes from, and reset goes to the deployment's default;
- everything else sits under its group in a collapsed "Show N deployment values
  (read-only, set in .env)" for Admins, grouped by name prefix
  (`GROUP_BY_PREFIX`); unmatched names land in a new Infrastructure group, and
  Directory & Discover is new too.

Admins see every value except the 9 secrets, which show set / not set and their
source. Reason: `SECRET_KEY` signs every login and `TOKEN_ENCRYPTION_KEY`
decrypts every account's bot tokens and AI keys; Admin is a grantable role, not
"has server access", and showing them would turn one stolen Admin session into
a permanent full compromise. The real backend already redacts them.

## Round 6: variant D, tools in a System tab (2026-10-11)

D is C with the tools moved out of Settings into a new workspace tab, System
(`SystemTab.tsx`, `system` in `WORKSPACE_TABS`): Logs (everyone), Network
telemetry, Database, Query console, Import / export (Admins). Settings keeps
Account (Profile, Password, Usage, Delete account) and Admin (Users, Quotas),
plus a "Logs and tools →" link that opens the tab.

The tab is closable and closed by default. Variant 0 stays main: the "+" menu
offers System only under `?variant=D`, and the palette's "Go to …" commands
leave it out. Fold-in work: add it to the palette, and give failed publishes /
summaries a "View logs" link into System → Logs.

## Round 7: A, B, C dropped; variant E, nested ids (2026-10-11)

A, B and C left the switcher and their code is deleted (`VariantA.tsx`, the
B/C modes and the generated Configuration page). D's code moved to
`VariantD.tsx`; the shared row pieces are in `row-parts.tsx`.

E is D with every setting addressed by a VS Code-style id the backend serves
(`NESTED_IDS` in the proto API): `namespace.section.name`, e.g.
`sync.schedule.intervalMinutes`, `appearance.channelCard.showBio`,
`retention.shared.postDays`, `access.registration.open`. Storage keys do not
change; each row shows "stored as <row.field>". The layout selects by id prefix
(`"sync.*"`), the second segment becomes a sub-heading, and search,
`?setting=<id>` deep links, "Copy setting id" and "Copy link to setting" use the
id. `.env` values get a derived id too (`NETWORK_FETCH_RETRIES` →
`network.fetch.retries`), shown next to their `.env` name.

## Round 8: the Settings tab in the workspace's own style (F, G, H)

Question: Settings looks like a different app from Channels, Posts and Action.
Why, and what would make it coherent? E breaks out of the tab's padding with a
full-height grey sidebar (no other tab has one), uses page-style text-lg
headings, Title-Case outline chips, a rectangular search box, flat rows with
13px help text, and the old settings fields (tall `p-3` mono inputs, all-caps
segments, raw enum values). The other tabs sit inside the padding in
`rounded-xl` bordered panels, with one toolbar (muted `h-9` search, `Label
value` pills from `PostFilterParts`), uppercase 10px micro-labels, and Action
rows on a fixed three-column grid.

All three variants are E's content (same hook, `useSettingsModel`) drawn with
those primitives through a `LookContext` (`app-skins.tsx`):

- F `panels`: toolbar with a Settings/Account/Admin segmented control, scope and
  modified pills and a "Go to" pill; one Action-style panel per group, stacked.
- G `rail`: a navigation panel (the app's selected style) left, one group at a
  time right; search widens to every group.
- H `cards`: compact two-column group cards (name and control only, the rest on
  hover); big production panels open in a sheet.

Still old-style inside all three: the production panels (AI keys, proxies, bots,
start time) and the Account/Admin page bodies (Users table, profile form).
Folding in means restyling those to the same primitives.
