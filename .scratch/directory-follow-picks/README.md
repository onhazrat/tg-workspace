# Directory: pick followed channels (prototype)

Throwaway. Question: can a subset of your follows feed the Directory's
relation filters (Shared parents / children, Cited by, Cites) by ticking them?

Variants on `/workspace?tab=directory&variant=`, switch with the floating bar
or Alt+Left/Right. A to E were explored and dropped; F kept what won from
each (history of this branch has them).

- `0` is main exactly.
- `F` is everything kept:
  - Followed rows tick like any other; the header ticks the whole page; the
    bulk bar's Follow and Dismiss act on the unfollowed ticks only ("Follow
    3 of 5") and ticks survive a follow. Cited by / Cites fill from the
    picks (ticks, Channels tab selection, every follow, a pick set).
  - Keyboard mode (j / k, gg / G, ] / [, x f d o): Enter opens or closes the
    panel, which follows the highlight while open; Esc drops the highlight.
  - "Why it's here" shows three citing Posts until "Show N more".
  - Phone layout (below `md`): the controls in a full-screen sheet behind one
    button beside the search, rows as two-line cards, the panel a bottom
    sheet over the list, the bulk bar on one sideways-scrolling line.
  - Named pick sets: a Sets menu saves the ticks under a name; Shared
    parents / children compare with a set live; "Pick set" in the Filters
    picker adds an In-set Condition (negatable) through a new `in`
    Condition on the Directory reads; rows show their sets. Per browser
    for now; folding in needs a per-Account table.
  - The search placeholder names what the search looks in ("Search names
    and bios").

Seen at iPhone 12 Pro size (390x844): main's bar fills the first screen and
the first row starts at y 820; C's first card is at 520. The app's own header
(title, icons, tab strip) takes the top ~200px on every tab, which no
Directory variant can fix.

Variants 0 to E are frontend only: picks resolve to handles in the browser.
F's In-set Condition is new on the server, so `/api/v1/data/directory*` is
served from this branch's router by a local prototype API (read-only role),
and everything else goes to the deployment's API. Follow and Dismiss are real.

Run (placeholders, see docs/agents/prototyping-with-live-data.md):

1. Tunnel to the database on :5433 (the guide's reconnecting loop).
2. `cd backend && PROTO_API_BASE=<api-base> PROTO_PG_USER=<role> PROTO_PORT=8013 uv run python scripts/proto_directory_api.py`
3. `cd frontend && PROTO_API_PORT=8013 PLAYWRIGHT_API_URL=<api-base> bun run dev --host 127.0.0.1 --port 5185`
4. `tailscale serve --bg --https=5185 http://127.0.0.1:5185`

Open questions for the fold-in:

- Cited by / Cites take fixed handles; a live picks source (like Shared's)
  needs a text-form word and wire resolution, and runs into the 50 cap.
- Should a ticked followed row look different from a ticked unfollowed one?
