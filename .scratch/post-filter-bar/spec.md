# Post filter bar

Status: ready-for-agent

Ticket prefix: `PFB`.

Settled by a four-round UI prototype (2026-09-29 to 2026-09-30) and a grilling session
(2026-09-30). ADR-025 records the one decision that reaches past this feature: Posts are filtered
and ordered by their Estimated View count. The terms **Estimated View count** and the widened
**Scope** are in `CONTEXT.md`.

## Problem Statement

The Posts tab's filter section is four separate panels stacked on top of each other. There are two
search inputs side by side, one by keyword and one by meaning, and the meaning one shows whether or
not the account can use it. Every group carries an uppercase micro label. Every option is a chip,
so the section is tall whether or not anything is set, and nothing on it says which filters are
currently on. Clearing them means finding each one.

It also cannot answer two questions an Account keeps asking of its feed: "only the Persian ones"
and "only the ones people actually saw". A Post's Language is stored but not filterable. A Post's
View count is stored but can neither filter nor order the feed.

The controls it does have are narrow. Media is one choice, so "photos or videos" is impossible. The
order is newest first or grouped by channel, and grouping is an order rather than something that
combines with one. The per-channel cap keeps the newest N or a random N, so under any other order
it would keep the wrong N.

## Solution

One compact bar replaces the panel. The Analysis window sits small on the left and the search box
large on the right. The search box searches by keyword as you type, and, only when the account has
semantic features on, a Keyword / Meaning switch inside it runs a meaning search on Enter.

Under them, one row of pills: **Type**, **Media**, **Language**, **Views**, then **Order**,
**Per channel**, and the **Grouped by channel** toggle last. A pill reads `Label value` and fills
in when set. Each opens a small form. A footer strip says how many Posts are shown and lists every
active filter as a removable chip, with "Clear all".

Media and Language take several values. Views filters on a Post's View count, either as Telegram
shows it now or as its Estimated View count, at least or at most any number. The Order can be
newest, oldest, most views or fewest views; grouping by channel is a separate toggle that keeps the
chosen order; and the per-channel cap keeps the first N in that order, or N at random.

Everything on the bar is part of the Scope, so a Summary, Chat, Tag run or Discover report made
from the Posts tab runs over exactly the Posts the Account is looking at, and its Artifact records
the whole filter set.

## User Stories

### The bar

1. As an Account, I want the Analysis window and the search box on one row, so that the two things I change most are the first things I see.
2. As an Account, I want the Analysis window small on the left and the search box large on the right, so that the search box has room to type into.
3. As an Account on a narrow screen, I want the Analysis window and the search box to stack with the window first, so that neither is squeezed.
4. As an Account, I want every other filter as a pill in one row, so that the section takes one row of height when nothing is set.
5. As an Account, I want a pill to show its current value, so that I can read the whole filter state without opening anything.
6. As an Account, I want a pill to fill in when it is not at its default, so that I can see at a glance which filters are on.
7. As an Account, I want each pill to open a small form rather than a menu, so that it can hold a typed number as well as choices.
8. As an Account, I want a footer that says how many Posts are shown, so that I know what my filters left.
9. As an Account, I want every active filter as a removable chip in the footer, so that I can drop one without finding its pill.
10. As an Account, I want "Clear all" once two or more filters are on, so that I can start over in one click.
11. As an Account, I want labels in sentence case, so that the section reads as text rather than as a row of shouted tags.

### Search

12. As an Account, I want one search box, so that I do not have to decide which of two boxes to type into.
13. As an Account, I want a keyword search to filter as I type, so that I see results without pressing anything.
14. As an Account with semantic features on, I want a Keyword / Meaning switch inside the search box, so that I can search by meaning from the same place.
15. As an Account with semantic features on, I want a meaning search to run on Enter, so that I am not spending a query on every keystroke.
16. As an Account with semantic features off, I want no meaning switch at all, so that the bar never offers something that cannot work for me.
17. As an Account running a meaning search, I want every pill on the bar to still apply to its results, so that the bar means the same thing in both modes.

### Type

18. As an Account, I want Type to stay one choice among All posts, Original, Forwarded and Forwarded from channels I do not follow, so that its meaning does not change.

### Media

19. As an Account, I want to tick several media kinds, so that I can see photos or videos together.
20. As an Account, I want a Post to match if it matches any ticked kind, so that ticking more widens the feed rather than narrowing it.
21. As an Account, I want no ticked kind to mean any media, so that the default shows everything.
22. As an Account, I want each media kind to show how many Posts carry it, so that I know what a choice will leave before I make it.
23. As an Account, I want Text-only and Media-only kept as kinds, so that "posts with no words" stays expressible.

### Language

24. As an Account, I want to tick several Languages, so that I can read the Persian and the English Posts together.
25. As an Account, I want the Languages offered to be the ones present, most frequent first, so that the list is short and the likely choice is on top.
26. As an Account, I want each Language to show its Post count, so that I know how much each one holds.
27. As an Account, I want a Post with no words listed as "No text" and one whose words cannot be placed as "Undetermined", so that neither is mistaken for a real Language.
28. As an Account, I want the filter to use the Post's own Language rather than its Channel's, so that a Persian Channel's English Post is found by "English".
29. As an Account, I want a Post whose Language has not been read yet to match no Language filter, so that the filter never claims a Language nobody read.

### Views

30. As an Account, I want to keep only Posts with at least a number of views, so that I can read what people actually saw.
31. As an Account, I want to keep only Posts with at most a number of views, so that I can find what was missed.
32. As an Account, I want to type any number, as `25000`, `25k`, `2,500` or `1.5M`, so that I am not limited to presets.
33. As an Account, I want a log-scale slider under the number, from 100 to 1M, so that I can pick a rough size without typing.
34. As an Account, I want the at least / at most choice shown as Popular and Niche cards, so that the direction reads as what it means.
35. As an Account, I want a Views tab that filters on the View count Telegram shows now, so that the number matches what I see on the Post.
36. As an Account, I want an Estimated views tab that filters on the Estimated View count, so that a two-hour-old Post is judged by where its views are heading rather than where they are.
37. As an Account, I want Estimated views selected by default, so that young Posts are treated fairly unless I ask otherwise.
38. As an Account, I want each tab to say in one line what it measures, so that I can choose between them.
39. As an Account, I want a Post with no View count to match no views filter, so that "unmeasured" is never read as zero.
40. As an Account, I want a Post too new to judge to be hidden by an Estimated views filter, so that a guess is never presented as a measurement.
41. As an Account whose Estimated views filter hid Posts for being too new, I want the footer to say how many, so that an empty Live window explains itself.
42. As an Account, I want the pill to read `Popular, 10K views` or `Popular, 10K est. views`, so that I can tell which measure is on without opening it.

### Order and grouping

43. As an Account, I want to order Posts newest first, so that I see what just happened.
44. As an Account, I want to order Posts oldest first, so that I can read a period in the order it happened.
45. As an Account, I want to order Posts by most views, so that I see what people saw most.
46. As an Account, I want to order Posts by fewest views, so that I can find what was missed.
47. As an Account, I want the views orders to use the measure the Views pill has selected, even with no threshold set, so that the order and the filter never disagree about what "views" means.
48. As an Account, I want Posts with no measurement last in both views orders, so that unknowns never crowd the top.
49. As an Account, I want grouping by channel as a toggle separate from the order, so that I can group any order.
50. As an Account grouping by channel, I want each channel's block to sit where its first Post falls under my order, so that "most views, grouped" puts the channel with the most-viewed Post first.
51. As an Account grouping by channel, I want Posts inside a block to keep my order, so that grouping does not silently re-sort them.

### Per channel

52. As an Account, I want to cap Posts per channel at any number, so that one prolific channel does not drown the rest.
53. As an Account, I want a stepper and 1 / 3 / 5 / 10 / 20 shortcuts, so that common caps are one click.
54. As an Account, I want the cap to keep each channel's first N in my order, so that under most views a cap of 10 keeps each channel's 10 most-viewed Posts, not its newest 10.
55. As an Account, I want the cap's first choice to be named for my order (Newest, Oldest, Top by views, Bottom by views), so that the pill never says "newest" when it is not.
56. As an Account, I want a Random choice that keeps N at random, so that I can sample a channel.
57. As an Account paging a randomly capped feed, I want the same Posts on every page, so that scrolling neither repeats nor skips.

### Scope and Artifacts

58. As an Account, I want a Summary made from the Posts tab to read exactly the Posts I see, in my order and under my cap, so that the Artifact describes what I was looking at.
59. As an Account, I want Chat, Tag and Discover to honour the same filters, so that no Action quietly widens my selection.
60. As an Account, I want an Artifact to record the Language, media, views, order, grouping and cap it was made from, so that it can be inspected and restored.
61. As an Account opening an Artifact made before this change, I want its recorded Scope to read the same as it did, so that history is not reinterpreted.
62. As an Account with a scheduled Summary, I want it to keep running over the Scope it was scheduled with, so that the change does not alter what arrives.
63. As an Account, I want the selection-size check before a Summary to count under my filters, so that a selection that fits is not refused.

### Persistence

64. As an Account, I want my filter choices remembered in this browser, as the existing ones are, so that reloading the Posts tab keeps them.
65. As an Account, I want a View-as session's stored filters kept apart from mine, so that looking at somebody else's feed does not change my own.

## Implementation Decisions

### Scope fields

- Every new control is a field of the Scope's filter half, the one shape the feed request, the
  Action submission and the frozen Scope on every Artifact share. Adding it there is what makes the
  feed, the counts, the prompt path, Discover and scheduled Summaries honour it, and what makes an
  Artifact record it.
- The filter half gains or changes these fields (shape settled in the prototype and the grilling):

  ```
  languages:            string[]                  # empty = any Language
  media:                MediaKind[]               # empty = any; a Post matches ANY kind
  view_measure:         "views" | "estimated"     # default "estimated"
  views:                { op: "gte" | "lte", value: int } | null
  sort:                 "newest" | "oldest" | "most_views" | "fewest_views"
  group_by_channel:     bool
  max_per_channel_mode: "ordered" | "random"      # was "latest" | "random"
  ```

  `MediaKind` is the existing six: text_only, media_only, photo, video, link_preview, grouped.
- Values stored in the old shape are mapped when read, so every existing Artifact and scheduled
  Summary keeps its meaning: `media: "all"` reads as `[]` and a single kind as `[kind]`;
  `max_per_channel_mode: "latest"` reads as `"ordered"`; `sort: "time"` reads as `"newest"`; and
  `sort: "channel_time"` reads as `"newest"` with `group_by_channel: true`. Every old order was
  newest first within a channel, so "first N in the order" keeps exactly the Posts "latest N" kept.
- A value this server does not implement is still refused with a 422, not dropped.

### The feed and the counts

- Language filters on the Post's own Language column. A Post with a null Language never matches.
- The media set is an OR of the existing per-kind predicates.
- The views filter compares `view_measure`'s value with `op` and `value`. A Post whose value is
  null never matches.
- The per-channel cap ranks each channel's Posts by **the chosen order** (or by the seeded random
  order for `random`) and keeps the first N, before the page's own order and offset.
- Order keys: newest and oldest on the Post's timestamp; most and fewest views on `view_measure`'s
  value, nulls last in both directions. Every order ends in the existing stable tiebreak so offset
  paging stays deterministic.
- Grouping leads the order with each channel's best key under the chosen order (its newest, oldest,
  most or fewest), so a channel's block sits where its first Post falls, then the chosen order
  inside the block.
- The counts route answers a response model, `{counts: {channel: n}, tooNewToJudge: n}`, instead of
  a bare map. `tooNewToJudge` counts the Posts an Estimated views threshold hid for being under the
  estimation floor, as one more filtered aggregate in the query that already runs. The service
  function the AI paths call to size a selection keeps answering the per-channel map.
- Counts stay independent of the cap mode: each channel's count is clamped to the cap, which is the
  same number whichever Posts the cap keeps.

### The Estimated View count (ADR-025)

- A Post's Estimated View count is its View count once it is at least the settling age old. For a
  younger Post observed at or past the estimation floor, it is the View count divided by the current
  Settling curve's share at the Post's age at observation. Below the estimation floor it is null:
  too new to judge.
- The server computes it per request, in SQL, as an expression built from the current curve (the
  newest fit, or the seed curve before the first) and the reach settings. Nothing is stored.
- The same function exists in three places: the Python reach module (which already applies the
  curve to Channel Reach), the SQL expression, and a client twin for the semantic path. The client
  receives the current curve and settings from the server.
- `views_count` stays unindexed, so the counter refresh stays a HOT update (ADR-024). The views
  orders sort the Scope's rows without an index.

### Semantic search

- A meaning search still fetches its ranked Posts through RAG and filters them in the browser.
  The client pipeline gains the same Language, media set, views filter, four orders, grouping and
  order-following cap, so the bar means the same thing in both modes.
- The meaning switch shows only when the account has semantic features on.

### The bar (A1b)

- Layout, top to bottom: one row with the Analysis window control (unchanged, as wide as its
  summary) and the search box (large, taking the rest); the pill row; the footer strip.
- **Views** pill copy: label `Views`; value `Any`, or `Popular, 10K views` / `Niche, 1K views` on
  Views and `Popular, 10K est. views` on Estimated views. Inside: two underline tabs, **Views**
  ("What Telegram shows now. Young posts read low.") and **Estimated views** ("What a post's views
  are expected to settle at. Posts under 3 hours are too new to judge."); two cards, **Popular**
  (at least this many) and **Niche** (at most this many); the number box with the word "views" and
  a Clear link; a log-scale slider snapping to 100, 250, 500, 1K, 2.5K, 5K, 10K, 25K, 50K, 100K,
  250K, 500K, 1M. Typing any number stays allowed; the slider shows the nearest step.
- **Order** pill: Newest first, Oldest first, Most views, Fewest views.
- **Per channel** pill: value `No limit`, `Newest 10`, `Oldest 10`, `Top 10 by views`,
  `Bottom 10 by views` or `Random 10`. Inside: "Posts from each channel", a − [n] + stepper, 1 / 3 /
  5 / 10 / 20 shortcuts and a No limit chip; "Which ones", two cards, the first titled and described
  by the order ("The 10 most recent", "The 10 earliest", "The 10 with the most views", "The 10 with
  the fewest views") and the second Random ("10 picked at random"), greyed while there is no cap;
  a note, "The first choice follows the Order."
- **Grouped by channel** is a toggle pill at the end of the row.
- **Media** and **Language** pills open checkbox lists with counts and an "Any" reset; the pill
  reads `Any`, the one choice, or `N selected`.
- The footer adds "N too new to judge" when the counts report any.
- The old panel, its two search inputs and its active-search banners go.

### Persistence and commands

- The new filters persist where the existing post filters do: the per-account scoped browser
  storage, one key each, with the old single-value media and sort keys read into the new shapes
  once. They do not move into the settings schema.
- The command palette's post-filter commands move to the new shapes (media as a set, the four
  orders, grouping as its own command).

## Testing Decisions

- A good test drives a public seam with the inputs an Account's request would carry and asserts
  what comes back. It never asserts on a query's text or a component's internals. Every behaviour
  test is watched failing before it is trusted.
- **The feed over HTTP** (`POST /data/posts` and `POST /data/posts/counts`, real database, two live
  accounts) covers every server behaviour: Language including null, the media set's OR, both view
  measures at both directions including null and too-new Posts, the four orders with nulls last,
  grouping's block placement, the cap keeping the first N under each order, random paging without
  repeats, `tooNewToJudge`, the 422 on unknown values, and old wire values reading as their new
  meanings. Prior art: the existing feed, pagination and tenancy-scoping tests.
- **The Scope record**: an Action submitted with every new filter comes back with the same values
  on its Artifact's frozen Scope; rows stored in the old shape read back mapped; the prompt path
  assembles in the chosen order and cap. Prior art: the existing frozen-scope tests, including the
  one asserting that every filter a caller can submit survives into the record, and the
  prompt-assembly tests.
- **Semantic parity**: the client post-view pipeline applied to a fixed set of Posts yields what
  the server yields for the same filters. Prior art: the existing post-view pipeline tests.
- **One estimate, three implementations**: one shared fixture table of (View count, age, curve,
  settings) to expected Estimated View count, covering the seed curve, a fitted curve, the settling
  age boundary and the estimation floor, asserted against the Python reach function, the SQL
  expression and the client twin. This is the only new seam; three copies of one formula drifting
  apart is the likeliest defect, and the feed tests alone would not see the client's.
- **Acceptance measurement**: `EXPLAIN ANALYZE` of a views-ordered feed page for staging's
  largest account over a 7-day window, recorded in the ticket, before deciding that `views_count`
  needs no index.
- No Playwright spec: the layout was validated in the prototype and the behaviour is covered above.

## Out of Scope

- Filtering or ordering by Channel Reach. Reach stays a Channel measure, computed on read.
- A views range (at least X and at most Y together). One threshold with a direction.
- Storing the Estimated View count, or indexing `views_count`, unless the acceptance measurement
  demands it.
- The prototype's losing layouts: a facet rail beside the feed, a filter sentence, a typed query
  line (`lang:fa views:>=10k`), inline Filter/View rows, and the other Reach and cap forms.
- Moving post filters into the settings schema.
- The ticket split, still to be decided.

## Further Notes

- The prototype is the primary source for the layout and copy: local branch
  `prototype/post-filter-ui`. Rounds: `d06f661` (three layouts, command bar won), `cf5cd8c` (three
  command-bar revisions, pills with forms won), `3250b56` (multi-select media), `fdcf03c` (grouping
  last), `a6274ee` (three Reach and cap forms, the guided one won), `3bdbe9f` (the cap follows the
  order), `daf345e` (three search and window placements), `85af9d6` (the final top row). Run it
  with `cd frontend && bun run dev` and open `/workspace?tab=posts&variant=A1b`. The prototype
  filtered the *loaded page* in the browser and measured Channel Reach; the build does neither.
- The prototype's per-channel cap first shipped as "newest N, then re-sort", which under a views
  order showed the newest N labelled as the top N. The order-following cap is the fix, and the
  reason the cap mode is renamed rather than reinterpreted.
