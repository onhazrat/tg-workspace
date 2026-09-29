# Post filter bar

Status: needs-triage

Ticket prefix: `PFB`.

Settled by a UI prototype on 2026-09-29. The prototype is the primary source: branch
`prototype/post-filter-ui` (local), commits `d06f661` (round 1), `cf5cd8c` (round 2), `3250b56`
(multi-select media), `fdcf03c` (the winner's final layout). Run it with
`cd frontend && bun run dev`, then open `/workspace?tab=posts&variant=A1`; `?variant=current` is
today's panel for comparison. It stays off `main`.

## Question the prototype answered

What should the Posts tab's "Post Filtration" section look like once it also filters by Language
and Reach? It looked like four separate panels: two search inputs side by side, uppercase micro
labels on every group, chips for everything, and nothing that said which filters were on.

## Verdict

**Variant A1, "pills with forms".** Round 1 compared a command bar (A), a facet rail beside the
feed (B) and a filter sentence (C); A won. Round 2 compared three revisions of A: pills that open
small forms (A1), a typed query line (A2) and two inline Filter/View rows (A3); A1 won, with the
group toggle moved to the end of the bar.

## The layout

1. One search box, with a Keyword / Meaning switch inside it (Meaning only when embeddings are
   on). Keyword filters as you type; Meaning runs on Enter. It replaces the two inputs.
2. The Analysis window control beside the search box, unchanged.
3. One row of pills, in this order: **Type**, **Media**, **Language**, **Reach**, a divider,
   **Order**, **Per channel**, then the **Group by channel** toggle last. A pill reads
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
  or **At most**. The threshold is any number, typed as `25000`, `25k`, `2,500` or `1.5M`, with
  1K / 10K / 100K shortcuts. A Post with no measurement never matches a Reach filter.
- **Order** has four options: Newest first, Oldest first, Most reach, Least reach. Reach orders use
  the same measure the Reach filter is set to. Unmeasured Posts go last in both reach orders.
  Ties fall back to newest first.
- **Group by channel is a separate toggle**, not an order. Grouped, each Channel's block sits where
  that Channel's first Post falls under the chosen order, and Posts inside a block keep that
  order. This replaces `postSortOrder = "channel_time"`.
- **Per channel** takes any number (blank means no cap), plus Latest / Random for which Posts the
  cap keeps.

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
- The per-channel cap is already server-side. Settle how "Latest" interacts with a reach order
  (keep the latest N and then order them, or keep the top N by reach).

The prototype also moved the Order and Media state out of the scraper context into local state.
The real build puts the new filters in the settings schema (`lib/settings/schema.ts`) with the
others, so they persist the same way.

## Out of scope

- Round 1's B and C layouts and round 2's A2 and A3. A2's query syntax (`lang:fa reach:>=10k`) is
  a possible power-user addition later, not part of this.
- A maximum-and-minimum Reach range. One threshold with a direction covers the ask.
