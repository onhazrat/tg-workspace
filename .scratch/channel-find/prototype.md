# Find tab: prototype (reference only)

Status: prototype, throwaway. Never to be merged. Kept as a reference for the Directory tab, whose
design is on `main`: the spec and tickets in `.scratch/directory-tab/`, ADR-027 and ADR-028.

This branch holds the final state of the two variants that survived, as one snapshot without
their history. The others were folded into E or dropped: A (topic search) became E's search box,
B (an inbox of what your channels mention) became E's "Mentioned by your channels" criterion, C
(more like this) became E's Shared parents and Shared children, and D (a sidebar layout) lost to
E's top bar.

## The variants

`/workspace?tab=find&variant=E|G` (E is the default); the arrow keys or the bar at the bottom
switch between them.

| Variant | Idea | Signal |
|---|---|---|
| E, Filter (the winner) | Every Directory column, the reference graph and full-text, from a bar on top: facet buttons with count badges; a searchable Language menu with per-value counts, exclude and an "only" funnel; one Filters list of every measure plus cited by / cites @handle, "Mentioned by your channels" in the last N days, Shared parents and Shared children, whose bound editor draws the measure's histogram (log scale, median), offers at least / at most / between / no value and exclude, and previews the count before adding; a sort picker; chips that reopen their editor; a Columns menu; highlighted bio and matching-Post snippets while searching; row checkboxes with a bulk bar; Not interested with Undo; a detail panel with "Why it's here", collapsed sample Posts with View counts and clickable links; the view in the URL | `POST /browse` (generic bounds over a metric table, count-only previews, counts cached per account and view), `POST /histogram`, `/neighbours/{handle}`, `/feed/{handle}/posts`, `/dismiss/{handle}` |
| G, Graph | Channels as nodes, References as directed edges, walked 1 or 2 hops from a start Channel (`/lookup` autocompletes it). A pair citing each other both ways is two curved arrows. Click a node for details, Expand, Hide or Make centre (double-click); click an edge for every Post that formed it, filtered to the direction clicked. Hover lights a node's neighbourhood and dims the rest, labels fade in with zoom, Repel and Link distance sliders | `POST /graph` (top neighbours per node by distinct Posts, then every edge among the chosen nodes; `live_only` drops misspelled handles), `GET /edge-posts`. Drawn by `react-force-graph-2d`, chosen over Sigma.js (arrows, curves and edge clicks each need add-ons), Cytoscape.js (React wrapper unmaintained) and vis-network |

**Follow is real**: it runs the same bulk-follow job Discover uses, against whichever API the dev
server proxies `/api` to.

## How it ran

- **Data**: the deployment's own database, read live through a read-only database role that may
  write only its own scratch schema (`proto`), where the API builds its tables. Give the API a
  libpq connection string in `PROTO_DSN`. If the database port is not published, reach it with an
  SSH tunnel and keep the password in `~/.pgpass`, never in the repo.
- **Prototype API**: `PROTO_DSN=... PROTO_STAGING_API=<the deployment's API base URL> uv run
  python backend/scripts/proto_find_api.py` (port 8012, or `PROTO_PORT`). The first start builds
  its scratch tables (a reference count per Channel, about a minute; a full-text index of the
  Directory, about ten minutes, in resumable batches). It identifies the caller by forwarding the
  bearer token to the API's `/users/me`. Its connections run with parallel workers off: a
  parallel hash join over the References overflowed a database container's default 64 MB of
  shared memory.
- **Frontend**: `cd frontend && PROTO_API_PORT=8012 PLAYWRIGHT_API_URL=<the deployment's API base
  URL> bun run dev`. Vite proxies `/api` to that API and `/proto` to the prototype API, so the
  browser sees one origin. Log in with an account on that deployment.

## Files

- `backend/scripts/proto_find_api.py`: every query
- `frontend/src/components/find-prototype/`: `FindPrototype.tsx` (host, real follow),
  `VariantBrowseTop.tsx` (E), `VariantGraph.tsx` (G), `shared.tsx`
- `frontend/src/components/Common/PrototypeSwitcher.tsx`: the variant bar
- Mount points: `find` in `WORKSPACE_TABS`, `App.tsx`, the tab icon, `variant` and `find` in the
  workspace search, `/proto` in `vite.config.ts`

## What the data taught us

- Handles are lowercase in the Directory and the References; a Follow's channel id keeps its
  original case, so every join lowers it.
- Only Channels somebody follows have their own outbound References recorded, so "shared
  children" find little for picks nobody follows. "Shared parents" work for any Channel somebody
  cites.
- A plain @mention is stored as both a mention and a link Reference, so every count here is in
  distinct Channels or distinct Posts.
- Mention counts from a feed of Persian news channels are topped by the banks and state outlets
  they all cite; ranking by raw counts favours them.
- Most of a search's time on a remote database was network: four round trips became one statement,
  and the list stopped carrying bios.
