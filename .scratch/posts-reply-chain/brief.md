# Posts reply chain: brief for the spec

Input for `/to-spec`, then `/to-tickets` (prefix **RCH**). Every decision below
was settled in a grilling session on 2026-11-02 against prototype variant
**A3** ("Panel list"), which won over A, A2, B and C. The prototype is the
primary source: pushed branch `prototype/posts-reply-chain`
(one-commit snapshot `994b7a21`), code in
`frontend/src/components/posts-chain-prototype/` plus edits marked
`PROTOTYPE (posts-reply-chain)`. It was written under prototype rules; rewrite
it properly, do not promote it.

Terms: **Reply chain** (new), **Highlight** (amended: the Reply chain keeps its
own while open), **Reply**, **Album** (`GLOSSARY.md`). The Album split
(`.scratch/album-posts/brief.md`, ADR-046) ships before RCH-02.

## Shipping

| Ticket | What | State |
|---|---|---|
| RCH-01 | New-posts pill with `.`, and the skeleton in the loading layout's shape | Built and tested in this worktree; ships first, alone |
| RCH-02 | Chain route (backend) | After ALB |
| RCH-03 | The A3 panel (frontend) | After RCH-02 |

No variant or flag on main: each replaces today's behaviour.

## RCH-01: new Posts and the skeleton

- **Held new Posts.** A refetch (a sync, a Live minute, a selection rule) that
  brings a Post in above the last Post already shown holds it behind a sticky
  "↑ N new posts" pill with up to three Channel avatars. A click, or `.` in
  Keyboard mode, shows them and scrolls to the first (the Highlight lands on it
  with `.`). Posts after the last shown Post (a page loading) show at once.
  Held in every sort and even at the top, so the Compact grid never shifts
  sideways under the reader. The seen baseline resets when the filter, sort,
  window, spotlight or Selected-first changes (the feed's query key).
- **Skeleton.** The first load's placeholders take the shape that will load:
  a grid of compact cards in the Compact grid, full cards (avatar, two header
  lines, tick box, a photo on every other card, footer) otherwise.
- Built: `lib/posts/new-posts.ts` (`holdNewPosts`, unit-tested),
  `post-card/NewPosts.tsx`, `PostFeedResults.tsx` skeletons, `feedKey` on
  `usePostsFeed`, `.` as `LIST_KEYS.showNew`. A mocked Playwright spec
  `tests/summarizer-posts-feed-news.spec.ts` covers the pill and the skeleton
  (its reply-chain test is for variant A and goes with RCH-03).
- In the prototype these sit behind the variant switch; on main they are
  unconditional.

## RCH-02: the chain route

- `POST /data/posts/chain` with a Channel and post id: one recursive query
  walking up through `UNIQUE(channel_name, post_id)`, at most 100 levels. The
  parent's Channel is only in `reply_to->>'channel'` (empty means the reply's
  own Channel); a `reply_to.url` with no channel is a private parent, which
  stops the chain.
- Returns the Posts from the start up to the top, each with its real Pick
  state: the request carries the Analysis window and Post selection, unlike
  today's lookup, which sends neither and so reads every Post as picked.
- Says why it stopped: not a reply, parent not stored, private parent, or the
  100 cap.
- A later Album Post climbs as its Album's first Post (ADR-046), which holds
  the reply.
- Why: per-level lookups cost about 0.7 s each on staging; an 11-level chain
  (abdimedianet #62283) took 8.5 s.

## RCH-03: the panel (A3)

- **Where**: the Posts tab only. Elsewhere (Citations, Chat sources) the reply
  link keeps today's hover preview.
- **Opening**: `[` on the highlighted Post, or a click on its "Reply to #N"
  (desktop hover still previews; a tap on a phone opens the panel). `[` on a
  Post that is not a reply says so.
- **Content**: the whole Reply chain, oldest at the top, the starting Post at
  the bottom. Cards are the feed's own (every action), parents not stored show
  Telegram's excerpt. The Pick box shows only on Posts inside the window.
- **Keys** (the panel is its own keyboard list while open): the Highlight
  starts on the parent; `j`/`k`, `gg`/`G` and counts move it; every card key
  (`p`, `y`, `o`, `x`, `l`, `r`, `c`, `m`) acts on the highlighted card;
  `- + M .` work as in the feed; `]` or Esc closes and the feed's Highlight
  returns to the starting Post. `[` while open does nothing. The corner guide
  shows the panel's keys.
- **Highlight look**: in Keyboard mode the other cards are muted. With no
  keyboard (a phone, or the mouse with Keyboard mode off) nothing is muted and
  the ring marks the Post the reply answers.
- **The feed while open**: the feed's copy of the highlighted Post scrolls into
  view with a dashed outline (even under the panel); the starting Post's feed
  card carries sparse round dots when it is not the dashed one. The feed stays
  usable by mouse; a reply link outside the chain starts a new chain; one
  inside moves to its parent within the chain.
- **Photos**: `p` steps through the chain's own photos only and never pages
  the feed.
- **Scroll**: the highlighted card stays in view on every move (instant, not
  smooth) and holds still while cards above it load; after a finger scroll the
  top card is held instead.
- **Layout**: a portal to the page (a transformed ancestor made `fixed`
  relative to the feed); full screen on a phone with a sticky header and a
  thumb-sized close; a right-hand overlay on desk widths.
- **Closes on**: `]`, Esc, ×, a tab switch, a filter or sort change, a
  spotlight change, a window change. A Live-minute refetch leaves it open. Not
  in the URL.
- **Dropped** (from A2): `{`/`}`, step-by-step `[`, the Back button. And
  variant A's jump of the feed Highlight onto an in-feed parent.

## Findings on staging (2026-11-01/02)

- Replies are about one card in ten in the default feed; their parents are
  rarely in the feed because of the per-Channel cap.
- Long chains exist: whole Channels are self-reply threads
  (abdimedianet, 12 Posts from #62283).
- The prototype shows the chain growing level by level; RCH-02 makes it one
  read.

## Running the prototype

From the prototype branch: `cd frontend && PLAYWRIGHT_API_URL=<staging api base> bun
run dev --host 127.0.0.1 --port 5197`, then `tailscale serve --bg --https=5197
http://127.0.0.1:5197`. Open `/?tab=posts&variant=A3`; Alt+← / Alt+→ switch
variants. No prototype backend: everything reads the real API.
