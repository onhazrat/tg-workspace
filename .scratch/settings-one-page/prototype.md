# One-page Settings prototype

Status: needs-triage

Started 2026-10-19 from scratch (not from `prototype/settings-redesign`'s
variant E, by choice). Question: what does Settings look like when it is one
VS Code-style page listing every setting, `.env` value and code constant, each
addressed by a nested id, saying who may change it and when a change takes
effect, styled with the workspace's own primitives, and with `/settings` and
`/admin` folded in so the app lives at `/`?

## Variants (`?tab=settings&variant=`)

| Key | Idea |
|---|---|
| 0 | main's SettingsHub, unchanged |
| A | Panels + toolbar: Posts-style toolbar (muted search, `Scope` / `Show` / `Who` pills, count line), one Action-style panel per topic, rows on ActionRow's three columns, a sky dot and "Default X" on changed rows |
| B | Sticky TOC rail: VS Code's editor inside the tab padding. Sticky search with an operator filter menu, a scroll-spy contents rail, "Topic › Scope: **Title**" rows, a blue left bar on changed rows, gear on the left on hover |

The pink bar switches variants (← → too) and has an "as member" box
(`?as=member`) that previews the page with no permissions.

## What is real and what is stubbed

- Rows come from `backend/scripts/proto_settings_registry_api.py`, a
  standalone API (never mounted in the real one) reading the deployment's
  database as the read-only prototype role.
  - account and deployment rows: the real `build_configuration_catalog`,
    flattened per field; defaults from the same code run against empty stores.
  - `.env` rows: every `Settings` field in `config.py` with its comment; values
    from the deployment's own `/data/configuration` (already redacted). Secrets
    show set / not set only.
  - code rows: every module-level numeric or boolean UPPER_CASE constant in
    `backend/app` and `frontend/src`, with comment and file:line.
  - browser rows: generated in `model.ts` from `appSettingsSpec`.
- **Server-side writes are stubbed**: they go to the prototype's own
  `settings_registry_overrides` table and nothing in the app reads it.
  Browser rows write for real (that origin only).
- **Embedded panels write for real** (Profile, Password, AI keys, bots,
  destinations, proxies, Tor, setting groups, Users, Quotas): they are the
  production components, unchanged.
- Permissions are the account's real ones (`permissions_for`). Deployment rows
  are visible to everyone and editable with `data:admin`; `.env` and code rows
  are Admin-only and read-only, except eight `.env` knobs marked "Proposed:
  live" (registration, approval, token lifetimes, job retention, slow-request
  log), which research.md in `prototype/settings-redesign` argued should become
  runtime rows.

## Routing (branch-wide, not per variant)

- `/` is the workspace. `/workspace`, `/summarizer` keep working as redirects
  with their query string; `/settings` and `/admin` redirect to
  `?tab=settings&setting=account.yours.profile` / `admin.users.list`.
- The template shell (`routes/_layout*`) is deleted. `_tg` took over the
  awaited server-clock sync and the approval redirect; `QuotaWarning` moved
  into the workspace under the status banners. Sign out lives in
  Settings → Account.
- A new closable **Tools** tab holds Logs and Quick message (everyone) and
  Network telemetry, Table sizes, Import / export, Query console (Admins).

## Numbers (staging, 2026-10-19)

376 rows for an Admin: 26 browser, 10 account, 40 deployment, 120 `.env`,
182 code constants. A member sees 74, 42 of them locked. Cold registry load
over the tunnel is ~14 s, then 0.9 s (live catalog cached 5 minutes).

## Found while building it

- Defaults live in two places and disagree by omission: the backend has no
  default for the Tor fields or the publishing prefs, only the browser does
  (`NETWORK_SETTINGS_DEFAULTS`, `appSettingsSpec`). The prototype falls back to
  the browser's copy; a real registry needs one owner.
- `GLOBAL_KEYS` descriptions are written for developers ("Ticket 20 took the
  log and report windows back out…"); they cannot be shown as row help text.
- About a third of the code constants land in a catch-all `server` topic; a
  real registry would want an explicit topic per module, or an annotation.

## Run

Needs the DB tunnel on :5433 (see `docs/agents/prototyping-with-live-data.md`).

```
cd backend
PROTO_DSN="host=localhost port=5433 dbname=app user=<role>" \
PROTO_API_BASE=<deployment api base> PROTO_PORT=8031 \
uv run python scripts/proto_settings_registry_api.py

cd frontend
PLAYWRIGHT_API_URL=<deployment api base> PROTO_API_PORT=8031 \
bunx vite --port 5195 --strictPort --host 127.0.0.1
tailscale serve --bg --https=5195 http://127.0.0.1:5195
```

Open `/?tab=settings&variant=A` and log in.

## Round 2: B chosen, drawn with the workspace's primitives (2026-10-19)

Verdict: **B (sticky TOC rail)** is the direction. A stays on the switcher
for comparison only.

B now uses only pieces the Channels, Posts and Directory tabs already have,
gathered in `b-kit.tsx`:

| Need | Primitive | From |
|---|---|---|
| search bar | rounded card, big muted search box, row of pills, count line | Directory bar |
| scope filter, long enums | `Pill` + `Options` | Posts filter bar |
| on / off, filter toggles | `BarToggle` | Channels / Directory bar |
| short enums | inline segments | Directory "Name / Bio / Posts" (private there) |
| text and numbers | the `BarSearch` input class | Channels / Directory popovers |
| lists | table in a rounded card, quiet headers, hover rows | Directory table (private there) |
| add / edit | `pillClass` trigger opening a `BarPopover` form | `+ Follow`, `+ Add to Directory` |
| submit, destructive | `TgButton size="sm"`, `TgConfirmDialog` | everywhere |
| changed from default | blue left bar and "Changed · default X" (click resets) | blue is the selection colour |

Every hand-written panel has a B body in `b-panels.tsx` on that kit, with the
production stores and client calls (writes are real): Account (sign out,
profile fields that save on Enter, password in a popover, usage table, delete
with confirm), AI keys, bots, destinations, proxies (table with per-proxy
slots, test results, live health), setting groups (table, editor expands under
the row), Users (table; the row menu is still the old `UserActionsMenu`),
Quota limits (defaults table with inherited values as placeholders, overrides
table) and Quota usage (table, lift today).

Fold-in work this exposes: restyle `UserActionsMenu`'s
dialogs; the Tor panel is gone from B because its fields are rows, so its
Test / Rotate actions need a home.

Not in B yet: bot and chat auto-lookup and the Check buttons, test message.

## Round 3: the Directory's private pieces are shared (2026-10-19)

The two looks B had copied from the Directory now live in `components/ui/`,
and the Directory itself uses them (same class strings, 168 Directory tests
green):

- `tg-inline-segments.tsx`: `TgInlineSegments` + `TgInlineSegment`, a
  pressed / unpressed button on a tinted track. Single choice or multi-select
  is the caller's; the Directory's Name / Bio / Posts is multi-select, B's
  `Segments` single.
- `tg-table-card.tsx`: `TgTableCard` (with an `after` slot for a pager),
  `tgTableHeadClass`, `tgTableRowClass`.

Both are fold-in ready (they are not prototype code). Still two segmented
controls in the app: `TgSegmentedControl` is the older uppercase look used by
the old Settings and Action's mode switches. Retiring it onto the inline one,
and moving the Discover, Tag and Network telemetry tables onto `TgTableCard`,
would change how those tabs look, so it was left alone.

The full unit suite also caught three things from rounds 1 and 2, fixed: a
`truncate` on a flex chip in A and B, B's row gear revealed on hover only, and
the View-as ribbon guard still reading the deleted `routes/_layout.tsx`.

## Round 4: one segmented control in the Action tab, a foldable contents tree

- The Action tab's Chat and Tag mode switches moved from `TgSegmentedControl`
  to `TgInlineChoice` (new, the single-choice form of `TgInlineSegments`,
  with disabled options), and `ACTION_SWITCH_OPTION_CLASS` is gone. That is
  production code, not prototype code. `TgSegmentedControl` remains in
  ReadingControls, DiscoverFilterBar, PostFilter, AnalysisWindowControl and
  the old Settings sections.
- B's contents rail is a tree, as in VS Code: a chevron folds each topic, its
  children are its panels and scope groups (with counts), a child jumps there
  and unfolds a hidden `.env` / code group. The topic being read opens on its
  own and closes once scrolled past, unless the user folded or unfolded it.
  Expand all / Collapse all on top. The current topic is the last one whose
  heading has passed the sticky bar (scroll listener, not an
  IntersectionObserver, which picked the topic hidden under the bar).
- The contents show how many settings differ from their default, as a blue
  count beside each topic and each scope group under it, in place of the dot.
