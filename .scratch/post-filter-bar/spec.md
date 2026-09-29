# Post filter bar

Status: needs-triage

Ticket prefix: `PFB`.

Settled by a UI prototype on 2026-09-29 and 2026-09-30. The prototype is the primary source:
branch `prototype/post-filter-ui` (local), commits `d06f661` (round 1), `cf5cd8c` (round 2),
`3250b56` (multi-select media), `fdcf03c` (group toggle last), `a6274ee` (round 3's three Reach
and Per channel forms), `3bdbe9f` (the cap following the order), `daf345e` (round 4's three top
rows), `85af9d6` (the winner's final top row). Run it with
`cd frontend && bun run dev`, then open `/workspace?tab=posts&variant=A1b`; `?variant=current` is
today's panel for comparison. It stays off `main`.

## Question the prototype answered

What should the Posts tab's "Post Filtration" section look like once it also filters by Language
and Reach? It looked like four separate panels: two search inputs side by side, uppercase micro
labels on every group, chips for everything, and nothing that said which filters were on.

## Verdict

**Variant A1, "pills with forms".** Round 1 compared a command bar (A), a facet rail beside the
feed (B) and a filter sentence (C); A won. Round 2 compared three revisions of A: pills that open
small forms (A1), a typed query line (A2) and two inline Filter/View rows (A3); A1 won, with the
group toggle moved to the end of the bar. Round 3 varied only the copy and the insides of the
Reach and Per channel pills: plain sentences (A1a), guided (A1b) and compact (A1c). **A1b won.**
Round 4 varied where the search box and the time range sit: search first and large (S1), the time
range as the card's title with separate keyword and meaning boxes (S2), and both inside the pill
row (S3). A1b's single row won, with the two swapped and resized.

## The layout

1. One row: the **time range** (the Analysis window control, unchanged) on the left, small, only as
   wide as its one-line summary; the **search box** on the right, large (`text-sm`, taller than
   the pills), taking the rest of the row. Both stretch to one height. On narrow screens they
   stack, time range first.
2. The search box searches by keyword as you type. **When the account has semantic features on**
   (`embeddingsEnabled`), a Keyword / Meaning switch sits inside the box; Meaning runs on Enter.
   With semantic features off there is no switch and no meaning mode. It replaces today's two
   inputs.
3. One row of pills, in this order: **Type**, **Media**, **Language**, **Audience** (Reach), a
   divider, **Order**, **Per channel**, then the **Grouped by channel** toggle last. A pill reads
   `Label value` and fills in when it is not the default. Each opens a small popover form, not a
   menu.
4. A footer strip: the post count, the existing subtitle, one removable chip per active filter,
   and "Clear all" once two or more are on.

Labels are sentence case; the uppercase `tracking-widest` treatment goes.

## Decisions

- **Type** stays single-choice (All, Original, Forwarded, Forwarded from unfollowed).
- **Media is multi-select.** A post matches if it matches **any** ticked kind. None ticked means
  any media. Each kind shows how many posts carry it.
- **Language is multi-select** over the Post's own `language` (LANG-01), not the Channel's.
  Options are the languages present, most frequent first, each with a count. `zxx` reads "No text"
  and `und` "Undetermined". A Post whose language is unread (null) never matches a language filter.
- **Reach** has three parts. The measure is **Channel reach** (the Channel's Reach, REACH-03) or
  **Post views** (the Post's `views_count`), default Channel reach. The direction is **At least**
  or **At most**. The threshold is any number, typed as `25000`, `25k`, `2,500` or `1.5M`. A Post
  with no measurement never matches a Reach filter.
- **The Reach form is A1b's.** The pill is labelled **Audience** and reads `Any`, or
  `Popular, 10K readers` / `Niche, 1K views` (readers for Channel reach, views for Post views).
  Inside: two underline tabs, Channel reach and Post views, each with a one-line explanation
  ("How many views a channel's posts typically settle at. Judges the source." / "How many views
  this post has. Judges the post itself, but young posts read low."). Then two cards,
  **Popular** (at least this many) and **Niche** (at most this many). Then the number box with the
  unit word and a Clear link, and a slider under it on a log scale from 100 to 1M that snaps to
  100, 250, 500, 1K, 2.5K, 5K, 10K, 25K, 50K, 100K, 250K, 500K, 1M. Typing any number is still
  allowed; the slider shows the nearest step.
- **Order** has four options: Newest first, Oldest first, Most reach, Least reach. Reach orders use
  the same measure the Reach filter is set to. Unmeasured Posts go last in both reach orders.
  Ties fall back to newest first.
- **Group by channel is a separate toggle**, not an order. Grouped, each Channel's block sits where
  that Channel's first Post falls under the chosen order, and Posts inside a block keep that
  order. This replaces `postSortOrder = "channel_time"`.
- **Per channel** takes any number (blank means no cap). **The cap follows the Order.** Its first
  choice keeps each channel's first N **in the chosen order**, not the newest N: under Most reach a
  cap of 10 keeps each channel's 10 with the most reach. The other choice is N at random. Found in
  round 3: the prototype first capped "newest 10" on the server and ordered afterwards, so under
  Most reach it showed the newest 10 re-sorted and labelled them "Newest 10".
- **The Per channel form is A1b's.** The pill reads `No limit`, `Newest 10`, `Oldest 10`,
  `Top 10 by reach`, `Lowest 10 by reach` or `Random 10`. Inside: "Posts from each channel", a
  − [n] + stepper, 1 / 3 / 5 / 10 / 20 shortcuts and a No limit chip; then "Which ones", two cards.
  The first card's title and line follow the Order (Newest, "The 10 most recent"; Oldest, "The 10
  earliest"; Top by reach, "The 10 with the most reach"; Lowest by reach, "The 10 with the least
  reach"), the second is Random, "10 picked at random". A note under them says "The first choice
  follows the Order." The cards grey out while there is no cap.

## What the prototype faked, and the real build must not

The prototype ran Language, Media (as a set), Reach, the four orders and grouping on the **loaded
page** in the browser. The feed is server-paged, so all of these belong in the feed query
(`POST /data/posts` and `POST /data/posts/counts`), and the counts must be of the window, not of
the loaded page:

- `media` becomes a list; `matchesMediaFilter`'s rules move server-side as an `OR`.
- `languages: string[]`.
- `reach: { basis: "channel" | "post", op: "gte" | "lte", value: int }`. Channel Reach is computed
  on read today (`channels.reach_by_channel`); filtering and ordering on it needs it available to
  the feed query without recomputing it per request.
- `sort: "newest" | "oldest" | "most_reach" | "least_reach"` and `group_by_channel: bool`,
  replacing `sort: "time" | "channel_time"`. `usePromptPosts` reads the same order, so a Summary's
  input follows the chosen order too; decide whether that is wanted.
- The per-channel cap is server-side today as "latest" (newest N) or "random". It becomes
  "first N in the chosen order" or "random": a window partitioned by channel and ordered by the
  chosen order, the same order the page is sorted by. `max_per_channel_mode: "latest"` is renamed
  or remapped, and the prompt path's cap follows too.

The prototype also moved the Order, Media and cap state out of the scraper context into local
state.
The real build puts the new filters in the settings schema (`lib/settings/schema.ts`) with the
others, so they persist the same way.

## Out of scope

- Round 1's B and C layouts and round 2's A2 and A3. A2's query syntax (`lang:fa reach:>=10k`) is
  a possible power-user addition later, not part of this.
- A maximum-and-minimum Reach range. One threshold with a direction covers the ask.
