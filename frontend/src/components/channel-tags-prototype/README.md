# Channel Tags prototype, never merge

Four asks about the Channels tab and the Tags around it, prototyped on the real
pages against a deployment's data, `?variant=` or the pink bar (left and right
arrow keys):

1. Order Tags by how they are used, over time.
2. Rename and delete Tags in the Channels tab as in the Directory, with one
   component everywhere, and funnel by Tag from the Directory's Tags dropdown.
3. A gear on each Setting group in the Channels tab's Groups dropdown.
4. Say what the Sort's "Last updated" is, and add a Last post sort and filter.

Variants left at the end:

- **0 Current**: main, unchanged.
- **A Tags by use on this tab**: one Tags dropdown on the Channels tab, the
  Directory and the Requests tab's Channels by Requests, each ordered by its
  own tab's use, logged in browser storage.
- **B**: A, with use kept on the server per account and tab, one counts route,
  the order held while a dropdown is open, a confirmation before a rename merges
  two Tags, and Last post on the cards with a "No post in 30 days" preset.

Dropped on the way: ordering by recent assignments (`assignedAt`) instead of
use, and a Manage toggle for rename and delete instead of row icons.

## Verdict (2026-10-28): B

What B settles, for the spec:

- **One Tags dropdown, three tabs.** The Channels tab's `FacetMenu` rows
  everywhere: tick, name, other actions, `selected/total`, funnel. Selection is
  leftmost and the funnel rightmost, every other action sits between the name
  and the count (the Groups gear included). In the Directory a tick ticks the
  Tag's channels; on the Requests tab it picks or leaves out their rows. A Tag
  with none of the tab's channels is not listed. Funnels in one dropdown join
  with OR; the Directory's go on its top-level AND.
- **Rename and delete on every row**, never on a derived or `group:` Tag.
  Delete asks with the channel count. A rename onto another Tag's name asks
  first, because the merge cannot be undone; a case-only rename does not.
- **Order by use, per tab, per account, on the server.** A use is a tick, a
  funnel, tagging with the Tag, or a rename. Each counts 1, halving every 14
  days. A rename carries the history to the new name on every tab. The order
  holds while a dropdown is open and changes on the next open.
- **Counts from the server**, one call per open: each Tag's channels in the
  tab's scope and how many are selected. Setting group Tags are not in
  `tg_tags`, so the route has to answer them too (the prototype fetched their
  handles instead).
- **Groups gear** opens that group in Settings (`?setting=sync.yours.settingGroups&settingGroup=<id>`).
- **Last synced** is the honest name for `last_updated`, written when a sync
  finishes; the Time filter's description said "refreshed" and was wrong.
- **Last post** is `lastPostAt` on `GET /data/channels/stats`, the newest of
  the timestamps the route already reads, so no extra query. It is a sort, a
  Time filter moment, a line on every card, and a preset, "No post in 30 days",
  which also matches a channel with no stored Post.

Not chosen, still open: a "Recent" section over a stable list, and moving
`group:` Tags out of the Tags dropdown into a Groups dropdown on the Directory
and the Requests tab.

## Running it

- The frontend: `PLAYWRIGHT_API_URL=<api url> PROTO_API_PORT=<port> bun run dev`
  in `frontend/`. `/api/v1/data/channels/stats` and `/proto/*` go to the
  prototype API, everything else to the deployment.
- The prototype API: `backend/scripts/proto_channel_tags_api.py`, against the
  deployment's database through a read-only role and a tunnel, as
  `docs/agents/prototyping-with-live-data.md` describes. It creates
  `<schema>.tag_uses` (`PROTO_SCHEMA`), its only write.
- Rename and delete go through the deployment's real Tag routes.
