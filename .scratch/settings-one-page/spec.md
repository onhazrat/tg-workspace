# Spec: Settings as one page on one registry

Status: ready-for-agent

Plan and decision table: `docs/settings-registry-plan.md`. Architecture:
`docs/migration/ADR-032-one-settings-registry.md`. Prototype: variant B on
branch [`prototype/settings-one-page` @ 2b81adbd](https://github.com/onhazrat/tg-workspace/tree/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af), notes in `prototype.md` beside this file.
Vocabulary (Account, Operator, Owner, Permission, Setting, Setting scope,
Setting id, Configuration, Tools, Budget) is `CONTEXT.md`'s.

## Problem Statement

An Account looking for a Setting today has to know where it is kept before it
can find it. Settings are split across two unrelated screens (the workspace's
Settings tab and the template's `/settings` and `/admin` pages), and the
Settings tab is a 22-node tree in which a third of the nodes are tools, not
Settings. Nothing on screen says whether a value lives in this browser, on the
Account or on the deployment, so an Account without the Permission can edit a
deployment Setting, see the control accept it, and never learn that the server
refused it. Nothing says whether a value differs from its default.

An Operator cannot see what the deployment is actually tuned by. `.env` values
are visible only in a separate admin catalog, constants in the code are not
visible at all, and nothing says which values take effect at once, which need a
restart and which need a deploy.

The screens also look like three different products: the template's admin and
profile pages, the old Settings tab's uppercase micro-type and terminal styling,
and the Channels, Posts and Directory tabs the rest of the workspace has moved to.

## Solution

One Settings page, inside the workspace, styled with the same pieces as the
Channels, Posts and Directory tabs. Every Setting and every piece of
Configuration is listed on it automatically from one registry the backend owns,
addressed by a dotted Setting id (`retention.yours.discoverReportDays`).

- Every row says its Setting scope (This browser, Your account, Deployment) or
  that it is Configuration (`.env`, Code), whether it differs from its default
  and what that default is, and, when the Account cannot change it, why.
- An Account sees the Settings that affect it. An Operator, through a
  `settings:manage` Permission, also changes deployment Settings and reads every
  `.env` value and code constant. Secrets only ever show "set" or "not set".
- A sticky search bar finds anything by title, Setting id, `.env` name,
  description or value, with operators (`@modified`, `@editable`, `@scope:…`,
  `@restart`, `@id:`). A contents tree beside the page follows the scroll, folds
  per topic like VS Code, and counts the changed values in each topic and scope.
- What `/settings` and `/admin` held (profile, password, usage, deleting the
  Account, users, quotas) becomes the Account and Operator topics on the same
  page. The workspace moves to `/`, and the old paths redirect.
- Tools (logs, quick message, telemetry, database, import / export, query
  console) leave Settings for a Tools tab of their own.
- AI model, language and temperature move from the browser to the Account.

## User Stories

### Finding a Setting

1. As an Account, I want every Setting I can see on one scrolling page, so that I never have to guess which screen holds it.
2. As an Account, I want a search box that matches titles, Setting ids, `.env` names, descriptions and current values, so that I can find a Setting by whatever I remember about it.
3. As an Account, I want the words I searched for highlighted in titles, ids and descriptions, so that I can see why a row matched.
4. As an Account, I want title and id matches ranked above description matches, so that the Setting I named comes first.
5. As an Account, I want `@modified` to list only values that differ from their default, so that I can review what has been changed.
6. As an Account, I want `@editable` to hide what I can only read, so that I see only what I can act on.
7. As an Account, I want `@scope:browser`, `@scope:yours`, `@scope:deployment`, `@scope:env` and `@scope:code`, so that I can narrow the page to one place values live.
8. As an Operator, I want `@restart` to list Configuration that takes effect only after a restart, so that I know what a restart would change.
9. As an Account, I want `@id:retention` to narrow to every Setting whose id starts with that prefix, so that I can open a whole topic by its address.
10. As an Account, I want a Search syntax menu that inserts each operator, so that I don't have to remember them.
11. As an Account, I want Scope, "Changed only" and "I can change" filters as pills in the bar, so that the common filters are a click away.
12. As an Account, I want a count of how many rows are shown out of how many exist and how many are changed, so that I know what a filter hid.
13. As an Account, I want "Nothing matches" when a search finds nothing, so that an empty page is not mistaken for an error.
14. As an Account, I want the search bar to stay on screen while I scroll, so that I can search again from anywhere on the page.

### The contents tree

15. As an Account, I want a contents tree listing every topic with its number of rows, so that I can see the shape of the page and jump around it.
16. As an Account, I want the topic I am reading highlighted in the tree as I scroll, so that I know where I am.
17. As an Account, I want each topic to fold and unfold with a chevron, so that I can keep the tree short.
18. As an Account, I want an unfolded topic to list its panels and its scope groups with their counts, so that I can jump straight to "Retention › Your account".
19. As an Account, I want the topic I am reading to open on its own and close once I scroll past, unless I folded or unfolded it myself, so that the tree follows me without fighting my choices.
20. As an Account, I want Expand all and Collapse all, so that I can see everything or nothing at once.
21. As an Account, I want the topics I folded or unfolded remembered in this browser, so that the tree looks the same after a reload.
22. As an Account, I want each topic and each scope group in the tree to show how many of its values differ from their default, so that I can find changes without searching.
23. As an Account, I want choosing a `.env` or code group in the tree to reveal that group if it was hidden and jump to it, so that one click gets me there.
24. As an Account on a phone, I want a Contents pill in the search bar that opens the same tree, so that I can navigate on a narrow screen.

### Reading a row

25. As an Account, I want each row headed "Topic › Scope: Title", so that I know what a Setting belongs to and where it is kept.
26. As an Account, I want a plain description under each title, so that I know what the Setting does without reading code.
27. As an Account, I want each row to show its Setting id and where its value is stored, so that I can quote it or find it in the code.
28. As an Account, I want a row that differs from its default to carry a blue bar and "Changed · default X", so that I can tell changed values at a glance.
29. As an Account, I want the default shown to be what the row would reset to and to say where it comes from (code, `.env`, deployment), so that "default" means the same thing on every row.
30. As an Account, I want a row I cannot change to show its value read-only with the reason ("Set by the Operator", "Read at startup: change .env and restart", "Constant in code: needs a deploy"), so that I know who or what can change it.
31. As an Operator, I want Configuration rows marked "Restart to apply", "Rebuild to apply" or "Needs a deploy", so that I know what changing them costs.
32. As an Account, I want `.env` and code groups hidden behind a "Show N" button until I search for them or choose them, so that the page stays readable.

### Changing a row

33. As an Account, I want on/off Settings as the workspace's on/off toggle, so that they look like every other toggle in the app.
34. As an Account, I want a Setting with a few choices as inline segments and one with many choices as a pill that opens a list, so that choosing looks the same as in the Posts and Directory bars.
35. As an Account, I want number and text Settings to save when I press Enter or leave the field, and Escape to undo my edit, so that I never hunt for a Save button.
36. As an Account, I want a value outside its bounds refused before it is sent, with the field marked, so that I find out at once.
37. As an Account, I want a write the server refuses to keep my draft, turn the field red and show the server's reason under it until I fix or cancel it, so that I never believe a value was saved when it was not.
38. As an Account, I want "Saved" shown briefly on the row after a successful write, so that I know it took.
39. As an Account, I want "Changed · default X" to reset the row when clicked, and Reset in the row menu, so that undoing a change is one click.
40. As an Account, I want a row menu with Copy Setting id, Copy link, and for Configuration Copy `.env` line or Copy file:line, so that I can share or look up a value.
41. As an Account, I want a link with `?setting=<id>` to open the page scrolled to that row and highlight it briefly, so that a shared link lands exactly.
42. As an Account with an old `?section=` link, I want to land on the matching topic, so that bookmarks keep working.
43. As an Account, I want a change in a browser Setting to apply at once on every tab, so that Settings feel live.

### Who sees and changes what

44. As an Account without `settings:manage`, I want to see the deployment Settings that affect me (post retention, sync interval, translation, reach), read-only, so that I understand the rules I work under.
45. As an Account without `settings:manage`, I want infrastructure Settings (network, jobs, media cache) and all Configuration left off my page, so that I am not shown what I cannot use.
46. As an Operator, I want to change deployment Settings from the same page, so that I do not need a separate admin screen.
47. As an Operator, I want every `.env` value the backend reads, with its comment, where it came from (environment, `.env`, code default) and its value, so that I can see how the deployment is configured.
48. As an Operator, I want every frontend build value shown with the value this browser actually runs, so that I can tell a stale build from a wrong setting.
49. As an Operator, I want every tuning constant in the code (retry counts, lease times, caps, lane weights) with its comment and file:line, so that I can find what a behaviour depends on without reading the source.
50. As an Operator, I want secrets shown only as "set" or "not set", so that a screen share or a stolen session never leaks a key.
51. As an Operator, I want a `.env` value that differs from the code's default counted as changed, but never a secret, so that "Changed" lists real deviations.
52. As an Owner viewing as another Account, I want the page to show that Account's Settings and refuse writes unless the session is elevated, so that View-as behaves here as everywhere else.
53. As an Operator, I want to grant `settings:manage` without granting the data tools, so that someone can tune the deployment without a query console.

### Account and Operator topics

54. As an Account, I want to see who I am signed in as and sign out from the Account topic, so that signing out has a home after the template sidebar goes.
55. As an Account, I want to change my name and email inline, saving on Enter, so that my profile is edited like any other row.
56. As an Account, I want to change my password from a form that opens from a pill, so that it reads like adding a channel or a key.
57. As an Account, I want my Telegram usage per Budget today as a table with allowance, ceiling and status, so that I know whether I am about to be slowed or stopped.
58. As an Account, I want to delete my Account behind a confirmation that says what goes with it, so that I cannot do it by accident.
59. As an Account, I want my AI keys as a table with provider and verification state, and an Add key form, so that I can manage what my Artifacts are paid with.
60. As an Account, I want my publishing bots and destinations as tables with add forms, the name looked up from the token or chat id, a Check action and a test message, so that nothing the old panel did is lost.
61. As an Account, I want my Setting groups as a table that expands into an editor under the row, and a New group form, so that I can tune groups where I tune everything else.
62. As an Operator, I want the proxy pool as a table with per-proxy slots, test results and live health, plus add, test all and reveal credentials, so that I can run the pool from Settings.
63. As an Operator, I want Tor's Test and Rotate actions on the Network topic, so that losing the old Tor panel loses no action.
64. As an Operator, I want the users as a table with role, status and join date, an Add user form, and edit, delete, View as and export from each row, in the same style as the rest of the page, so that managing Accounts does not drop into the template's look.
65. As an Operator, I want the deployment's quota allowance and ceiling per Budget as six Settings defaulting to their `.env` values, so that they are changed like any other deployment Setting.
66. As an Operator, I want per-Account quota overrides as a table with an Override form and a clear action, so that exceptions are visible in one place.
67. As an Operator, I want each Account's usage for a chosen day with a Lift today action, so that I can unblock someone in a hurry.

### AI preferences follow the Account

68. As an Account, I want my AI model, language and temperature stored on my Account, so that they follow me to every device.
69. As an Account who chose them in this browser before, I want my choices uploaded the first time I load the new version, so that I do not have to choose again.
70. As an Account, I want their defaults to come from the deployment's default model and language, so that a new Account starts with what the Operator chose.

### The workspace around Settings

71. As an Account, I want the workspace at `/`, so that the app's address is the app.
72. As an Account with a `/workspace`, `/summarizer`, `/settings` or `/admin` bookmark, I want to land on the matching place, query string kept, so that no link breaks.
73. As an Account waiting for approval, I want the pending page instead of a screen full of refusals when I open the app, so that I know what is happening.
74. As an Account, I want the quota warning shown in the workspace, so that I see it where I work rather than on a page I no longer visit.
75. As an Account, I want a Tools tab with my logs and quick message, so that the tools have a home outside Settings.
76. As an Operator, I want network telemetry, table sizes, import / export and the query console in the Tools tab, so that they are a click away without cluttering Settings.
77. As an Account, I want the command palette to offer a toggle or set command for every Setting I can change, a "Go to Settings → topic" for every topic, and a jump to any Setting by title or id, so that I can change Settings without leaving the keyboard.

### Consistency

78. As an Account, I want the Settings page, the Action tab's mode switches and the Posts and Analysis window switches to use the same segmented control as the Directory, so that one control means one look.
79. As an Account, I want every list on the Settings page to look like the Directory table, so that a table means one look.

## Implementation Decisions

### The registry

- A new backend **read model** builds the registry for the calling Account; it writes nothing. Writes delegate to the existing settings aggregates (the deployment settings store and the per-Account settings store), which stay the sole writers of their tables, as the service-kinds guard requires.
- **One declaration per Setting**, beside the existing settings registry that already classifies each settings key as deployment or per-Account. A declaration carries: Setting id, title, description, value type, bounds or choices, Setting scope, which settings key and field hold it, who can see it (every Account, or `settings:manage`), the Permission that changes it, and where its default comes from. Browser Settings are declared in the same list with scope "browser" and are stored by the frontend.
- **Setting ids** are declared, never derived: `<topic>.<segment>.<name>`, segments `browser`, `yours`, `deployment` for Settings and `env`, `code` for Configuration. Topics, in page order: Account, Appearance, Channels & sync, AI & models, Publishing, Network, Retention, Directory & Discover, Reach, Media, Background jobs, Quota, Access & sessions, Email, Database, Server, Operator. Ids carry no former names; renaming one breaks old links.
- **Defaults** are resolved, never restated: a Setting's default is what it resets to (account → deployment value or `.env` seed → code literal), computed by running the existing loaders against empty stores, and the row names the layer it came from. The defaults the browser alone holds today (Tor fields, publishing preferences) move into the declarations.
- **Configuration rows are generated**: `.env` rows from the backend's settings class (name, type, the comment above it) with values and sources from the running process; frontend build values from the build manifest the env catalog already records, their values reported by the running bundle; code constants from a generated catalog of every module-level numeric or boolean UPPER_CASE constant in backend and frontend source (value, expression, comment, file:line), regenerated by a pre-commit hook beside the env catalog's. Constants take their topic from an explicit module → topic map; a short exclusion list drops unit conversions.
- **Secrets** (names ending in the existing sensitive suffixes, or flagged in the env manifest) carry only "set" or "not set" and never count as changed.
- Network list and map fields (proxy URLs, per-proxy concurrency) and derived state (whether Tor is available, whether the `.env` fallback is in use) are not Settings rows; the proxy panel owns them. Runtime counters and markers stored beside Settings (sync runtime, follow backfill, view observations and the like) are not Settings at all.
- The six quota defaults (allowance and ceiling per Budget) become deployment Settings stored in the existing quota settings row, defaulting to their `.env` values.

### The API

- `GET /api/v1/settings/registry` returns the caller's topics and rows. A row's shape (from the prototype, trimmed to the decision-rich fields):

  ```ts
  interface SettingRow {
    id: string                 // Setting id
    title: string
    description: string
    topic: string
    scope: "browser" | "account" | "deployment" | "env" | "code"
    type: "boolean" | "integer" | "number" | "string" | "enum" | "json"
    options?: { value: string; label: string }[]
    min?: number
    max?: number
    value: JsonValue
    default: JsonValue
    defaultSource: "code" | "env" | "deployment"
    modified: boolean
    canEdit: boolean
    lockReason: string | null  // why canEdit is false, in the Account's words
    applies: "now" | "restart" | "rebuild" | "deploy"
    storage: string            // where the value is kept, for display
    sensitive: boolean
    envName?: string           // Configuration from .env
    sourceRef?: string         // file:line, for code constants
  }
  ```

  Rows the caller may not see are absent, not redacted. The response model is declared and closed; values are typed as JSON values, not an open dictionary, so the generated client stays useful.
- `PUT /api/v1/settings/{settingId}` takes `{ value }` or `{ reset: true }`, validates against the declaration (type, bounds, choices, Permission), writes through the owning aggregate, and answers the updated row. It answers 404 for an id the caller cannot see, 403 with the lock reason for one it can see but not change, 422 with the reason for a value out of bounds. Under View-as it follows the existing refusal unless the session is elevated.
- `settings:manage` is a new Permission in the closed set, granted to the seeded Owner role by the boot-time reconciliation; it changes deployment Settings and reads Configuration. Existing deployment-settings section routes keep gating on their current Permission until the store is rebuilt.
- The old admin configuration catalog route is deleted once the page reads the registry.
- `SettingsContext` keeps reading and writing whole sections for the rest of the app; after a registry write the page invalidates the affected section so every tab sees the new value. Rebuilding `SettingsContext` on the registry is a later ticket.
- AI preferences are a new per-Account settings key with three fields; the frontend's model, language and temperature read and write it, upload the browser's stored values once when the server has none, then stop storing them in the browser.

### The page

- One component tree for the page, drawn only with existing workspace primitives: the Directory bar (rounded card, large muted search box, a row of pills, a count line), `Pill` and `Options` from the Posts filter bar, `BarToggle`, `BarPopover` and `BarHeading` from the Channels bar, the shared inline segments and table card (extracted from the Directory in the prototype), the popover input style, `TgButton` and `TgConfirmDialog`. Nothing new is styled.
- A changed row has a blue left bar (the workspace's selection colour) and a "Changed · default X" link that resets it. The contents tree shows a blue count of changed values beside each topic and scope group.
- The current topic is the last one whose heading has passed the bottom of the sticky bar, measured on scroll; not an intersection observer, which picked the topic hidden under the bar.
- Folded state is kept in `scopedStorage`, per browser.
- Hand-written panels replace the old ones at parity: Account (sign in / out, profile fields, password form, usage table, delete), AI keys, bots, destinations, Setting groups, proxies (with Tor's actions on the Network topic), and the Operator topic (users with every row action, quota overrides, usage with Lift today). Writes in panels are explicit and real.
- The command palette builds its Settings commands from the registry; the catalog and the settings tree it read today are deleted.

### The workspace

- The workspace route is `/`. `/workspace` and `/summarizer` redirect keeping the query string; `/settings` lands on Account › Profile and `/admin` on Operator › Users.
- The template shell (its layout route, sidebar, dashboard and its admin and user-settings pages) is deleted. The workspace's own route guard takes over the awaited server-clock sync and the approval redirect; the quota warning renders in the workspace under the status banners.
- A Tools tab joins the closable tabs: Logs and Quick message for every Account, Network telemetry, Table sizes, Import / export and Query console for Accounts with the Permission each needs.
- The shared inline segments (single choice and multi-select) and table card are the only segmented control and table look on Settings, Action, Posts and the Analysis window; the older uppercase segmented control stays only where this spec does not reach.

## Testing Decisions

- A good test drives the feature through a seam a caller uses and asserts what that caller sees: which rows come back, which writes succeed, what the page shows. It never asserts how a row was built, which loader ran or which component rendered it, so the internals can change freely.
- **Seam 1: the registry's two routes**, through the test client with two live Accounts, one ordinary and one holding `settings:manage`. Cover:
  - each Account's set of row ids
  - that an infrastructure Setting and all Configuration are absent for the ordinary Account
  - that a secret's value is only "set" / "not set" and never "changed"
  - defaults and their sources across the three layers
  - a write per scope
  - 404 / 403 / 422 refusals and the lock reason
  - a reset
  - that a write lands in the owning table and is visible to the existing section route
  - View-as refusal and elevation
  - the quota defaults falling back to `.env`

  Prior art: the configuration-catalog, permission-check and account-isolation tests. The route-inventory, account-isolation probe, approval-gate and route-hygiene guards cover the new routes without new code; register the routes where they demand it.
- **Seam 2: the Settings page in a browser**, as Playwright specs with the registry response mocked, so they run against any backend. Cover:
  - search with each operator, highlighting and the empty state
  - the filter pills and the count line
  - changed counts in the contents tree for topics and scope groups
  - folding, auto-open of the current topic, Expand / Collapse all, folding remembered across a reload
  - a `.env` group revealed from the tree
  - `?setting=` and `?section=` landing
  - an Enter-to-save success, a client-side bounds refusal, a server refusal shown on the row, a reset
  - the palette's set and go-to commands
  - the phone Contents pill
  - `/settings`, `/admin`, `/workspace` redirects

  Prior art: the settings-sections and UI-primitives specs (route mocking), and the mocked-spec recipe in the project notes. Specs run serially, as the suite does today.
- **Static guards** (pytest, no HTTP), each mutation-tested before it is trusted:
  - every field of every settings key has exactly one declaration, and no Setting id is declared twice
  - every declared browser Setting exists in the frontend schema and vice versa
  - the constants catalog matches the source
  - every module with a constant has a topic

  Prior art: the settings-table-split and env-example guards.
- The page's internals (search parsing, grouping, change counting) get no unit tests of their own; seam 2 exercises them. New branching components that CI's CRAP ratchet flags get the props-only render test the ratchet asks for.
- The existing Playwright specs for the old Settings hub, the admin page and user settings are rewritten against the new page, not kept beside it.

## Out of Scope

- Making any `.env` value changeable at runtime (registration, approval, token lifetimes, View-as ceilings, job retention, slow-request log). Each is its own later ticket.
- Rebuilding `SettingsContext` on the registry; it keeps its section endpoints.
- Restyling the Tools tab's contents.
- Retiring the older uppercase segmented control where this work does not touch it (Discover's filter bar and Summary's reading controls move in the first ticket; anything else stays).
- Former ids or redirects for renamed Setting ids.
- A "Commonly used" section.
- Moving any other browser Setting to the Account besides AI model, language and temperature.

## Further Notes

- The prototype API reads staging through a scratch role and writes only to a scratch table; nothing from it ships. The real registry is mounted in the API and follows every route guard.
- On staging (2026-10-19) the prototype listed 376 rows for an Operator (26 browser, 10 account, 40 deployment, 120 `.env`, 182 code constants) and 74 for an ordinary Account. A cold registry build over a slow link took about 14 s; in the API, beside the database, it must stay one request with no per-row round trips.
- The prototype found Settings whose only default lived in the browser (Tor, publishing preferences) and settings-key descriptions written for developers; both are fixed by the declarations, which carry Account-facing descriptions.
- Delivery order and the per-ticket split are in the plan; tickets get prefix-numbered ids per the issue-tracker conventions when written.
