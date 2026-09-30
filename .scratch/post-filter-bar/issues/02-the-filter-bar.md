# PFB-02: The filter bar

**What to build:** The A1b filter bar replaces the Posts tab's filter panel. The Analysis window
sits small on the left and one large search box on the right, with a Keyword / Meaning switch
inside it only when the account has semantic features on. Under them one row of pills: Type,
Media, Language, Order, Per channel, and the Grouped by channel toggle last. A footer says how many
Posts are shown and lists every active filter as a removable chip. Behind the pills, the new
choices work end to end, on the server feed and counts, on every Action and its Artifact, and on
semantic results: several Languages, several media kinds, oldest first, grouping that places each
channel's block where its first Post falls, and a per-channel cap that keeps the first N in the
chosen order. The Views pill and the views orders are PFB-03's. See
`.scratch/post-filter-bar/spec.md`, "The bar (A1b)", "The feed and the counts", "Semantic search",
and user stories 1-29, 43, 44, 49-60 and 63-65. The prototype on local branch
`prototype/post-filter-ui` (`/workspace?tab=posts&variant=A1b`) is the reference for layout and
copy.

**Blocked by:** PFB-01.

**Status:** done

### The bar

- [x] One row: the Analysis window control, unchanged and only as wide as its summary, on the left; the search box, large and taking the rest, on the right; both one height. On a narrow screen they stack, window first
- [x] The search box searches by keyword as you type. With semantic features on, a Keyword / Meaning switch sits inside it and a meaning search runs on Enter; with them off there is no switch
- [x] One row of pills: Type, Media, Language, a divider, Order, Per channel, then the Grouped by channel toggle. A pill reads `Label value`, fills in when not at its default, and opens a small form
- [x] A footer shows the Post count and the existing subtitle, one removable chip per active filter, and "Clear all" once two or more are on
- [x] Labels are sentence case
- [x] The old panel, its two search inputs and its active-search banners are gone

### The pills

- [x] **Type** stays one choice: All posts, Original, Forwarded, Forwarded from unfollowed channels
- [x] **Media** is a checkbox list of the six kinds with each kind's Post count and an "Any media" reset; the pill reads `Any`, the one kind, or `N selected`
- [x] **Language** is a checkbox list of the Languages present, most frequent first, each with its Post count, "No text" for `zxx` and "Undetermined" for `und`, and an "Any language" reset
- [x] **Order**: Newest first, Oldest first
- [x] **Per channel**: value `No limit`, `Newest 10`, `Oldest 10` or `Random 10`. Inside, "Posts from each channel" with a − [n] + stepper, 1 / 3 / 5 / 10 / 20 shortcuts and a No limit chip; "Which ones" with two cards, the first titled and described by the order ("Newest", "The 10 most recent"; "Oldest", "The 10 earliest") and the second "Random", "10 picked at random", greyed while there is no cap; and the note "The first choice follows the Order."
- [x] Any number typed into the cap is accepted, as `12` or `1,000`; blank means no cap

### Behaviour, end to end

- [x] A Language filter keeps Posts whose own Language is ticked; a Post with no Language read yet never matches
- [x] A media set keeps Posts matching any ticked kind
- [x] Oldest first orders by timestamp ascending
- [x] Grouped by channel leads the order with each channel's best key under the chosen order, so its block sits where its first Post falls, and keeps the chosen order inside the block. Paging stays stable
- [x] The per-channel cap ranks each channel's Posts by the chosen order and keeps the first N; random keeps its seeded N
- [x] The counts honour Language and the media set; each channel's count is clamped to the cap
- [x] Summary, Chat, Tag and Discover run over the same Posts the feed shows, and the Artifact's frozen Scope records the Languages, media set, order, grouping and cap
- [x] Semantic results pass through the browser pipeline with the same Language, media set, order, grouping and cap, and give what the server would give for the same Posts
- [x] The new filters are remembered in the per-account scoped browser storage, one key each; a View-as session's are kept apart from the Owner's
- [x] The palette's post-filter commands cover the media set, both orders and grouping

### Tests

- [x] The feed over HTTP, with two live accounts: Language including a null Language; the media set's OR; oldest first; grouping's block placement under both orders; the cap keeping the first N under both orders; random paging without repeats. Prior art: the existing feed and tenancy-scoping tests
- [x] The Scope record carries every new value through an Action to its Artifact, and the prompt path assembles in the chosen order and cap. Prior art: the frozen-scope and prompt-assembly tests
- [x] Semantic parity: the browser pipeline applied to a fixed set of Posts matches the server for the same filters. Prior art: the post-view pipeline tests
- [x] Every new test is watched failing before it is trusted

## Comments

**2026-09-30, implementation notes.**

- **The pill counts are a route of their own**, `POST /data/posts/facets`
  (`services/posts.py::count_facets_in_scope`), fetched only while the Media or
  Language pill is open. Each facet is counted under every filter of the Scope
  but its own, and each channel's count is clamped to the cap, so a number is
  exactly what ticking that one choice alone would show. It sits on
  `VIEW_AS_READ_ONLY_PATHS` beside `posts/counts`. The counts route's response
  model is unchanged here; `{counts, tooNewToJudge}` is PFB-03's.
- **A meaning search shows no counts.** Its ranked Posts are not a scope the
  server can count, so the Language list falls back to the followed Channels'
  Languages, without numbers.
- **Grouping places a block by its best key** with a window function in the
  `ORDER BY` (`max`/`min(timestamp) OVER (PARTITION BY channel_name)`), which
  runs after the cap's `WHERE rn <= N`, so a capped block is placed by the
  Posts the cap kept. The grouped feed can no longer walk
  `ix_tg_posts_channel_name_timestamp` in order; it sorts the Scope's rows.
  PFB-03's acceptance measurement covers that sort too.
- **The browser pipeline gained the server's tiebreak** (timestamp, then
  channel name, then post id running with the timestamp), so a meaning search
  reads in the order the feed would give it. A meaning search now also applies
  the media set and the Language set, not only the Type.
- **The order and grouping are not footer chips.** They lay the Posts out
  rather than choosing them, so they fill their pills (the prototype's call).
- **Leaving Meaning ends the meaning search**, since the one box means one
  search at a time. "Search every channel, not only the selected ones" moved
  under the box in meaning mode.
- **Not run here:** the full Playwright suite. The one spec that clicked the
  old media chip (`tests/summarizer-channels.spec.ts`) opens the Media pill
  first now and passes.
