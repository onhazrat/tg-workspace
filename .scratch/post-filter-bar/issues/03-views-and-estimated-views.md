# PFB-03: Views and Estimated views

**What to build:** The filter bar gains a Views pill and two views orders. An Account can keep only
Posts with at least or at most any number of views, measured either as Telegram shows them now or
as each Post's Estimated View count, and can order Posts by most or fewest views on the same
measure. A Post too new to judge is hidden by an Estimated views threshold, and the footer says how
many were hidden so an empty Live window explains itself. It works end to end, on the server feed
and counts, on every Action and its Artifact, and on semantic results. ADR-025 is the decision this
implements: Posts are filtered and ordered by their View count or Estimated View count, never by
Channel Reach; the estimate is computed per request, not stored; `views_count` stays unindexed.
See `.scratch/post-filter-bar/spec.md`, "The Estimated View count (ADR-025)", the Views and Per
channel parts of "The bar (A1b)", and user stories 30-42, 45-48, 54 and 55.

**Blocked by:** PFB-02.

**Status:** ready-for-agent

### The Scope

- [ ] The Scope's filter half gains two fields and two orders (shape settled in the grilling):

  ```
  view_measure: "views" | "estimated"            # default "estimated"
  views:        { op: "gte" | "lte", value: int } | null
  sort:         "newest" | "oldest" | "most_views" | "fewest_views"
  ```

- [ ] A Scope stored before this ticket reads with `view_measure: "estimated"` and `views: null`, which filters nothing and changes no order
- [ ] Unknown values are refused with a 422

### The Estimated View count

- [ ] A Post at least the settling age old has its View count as its Estimated View count
- [ ] A younger Post observed at or after the estimation floor has its View count divided by the current Settling curve's share at its age when observed; the current curve is the newest fit, or the seed curve before the first
- [ ] A Post younger than the estimation floor, or with no View count, has none
- [ ] The server computes it per request as an SQL expression from the current curve and the reach settings; nothing is stored and `views_count` gets no index
- [ ] The browser has a twin for semantic results, fed the current curve and settings by the server
- [ ] One shared fixture table of (View count, age, curve, settings) to expected Estimated View count, covering the seed curve, a fitted curve, the settling-age boundary and the estimation floor, is asserted against the Python reach function, the SQL expression and the browser twin

### Behaviour, end to end

- [ ] A views threshold keeps Posts whose value under the selected measure is at least (`gte`) or at most (`lte`) the number; a Post with no value never matches
- [ ] Most views and Fewest views order by the selected measure even with no threshold set, with Posts that have no value last in both directions and the existing stable tiebreak after
- [ ] The per-channel cap, grouping and paging all follow the views orders as they follow the time orders
- [ ] The counts route answers `{counts: {channel: n}, tooNewToJudge: n}`, where `tooNewToJudge` counts the Posts an Estimated views threshold hid for being under the estimation floor, as one more filtered aggregate in the query that already runs. The service the AI paths call to size a selection keeps answering the per-channel map
- [ ] Summary, Chat, Tag and Discover honour the threshold and the views orders, and the Artifact's frozen Scope records the measure, threshold and order
- [ ] Semantic results obey the threshold and the views orders through the browser twin

### The bar

- [ ] A **Views** pill sits after Language. It reads `Any`, or `Popular, 10K views` / `Niche, 1K views` on Views and `Popular, 10K est. views` on Estimated views
- [ ] Inside: two underline tabs, **Views** ("What Telegram shows now. Young posts read low.") and **Estimated views** ("What a post's views are expected to settle at. Posts under 3 hours are too new to judge."), Estimated views selected by default; two cards, **Popular** (at least this many) and **Niche** (at most this many); the number box with the word "views" and a Clear link, accepting `25000`, `25k`, `2,500` or `1.5M`; and a slider snapping on a log scale to 100, 250, 500, 1K, 2.5K, 5K, 10K, 25K, 50K, 100K, 250K, 500K, 1M, showing the nearest step for a typed number
- [ ] The **Order** pill adds Most views and Fewest views
- [ ] The **Per channel** pill and first card follow them: `Top 10 by views`, "The 10 with the most views"; `Bottom 10 by views`, "The 10 with the fewest views"
- [ ] The footer adds "N too new to judge" when the counts report any
- [ ] The measure and threshold are remembered in the per-account scoped browser storage with the other filters

### Tests and measurement

- [ ] The feed over HTTP, with two live accounts: both measures at both directions, including a Post with no View count and a Post under the estimation floor; both views orders with nulls last; the cap and grouping under a views order; `tooNewToJudge`; 422s. Prior art: the existing feed tests
- [ ] The shared estimate fixture passes against all three implementations, and each is watched failing against a deliberately wrong curve
- [ ] The Scope record carries the measure, threshold and order through an Action to its Artifact. Prior art: the frozen-scope tests
- [ ] Semantic parity for the threshold and the views orders. Prior art: the post-view pipeline tests
- [ ] `EXPLAIN ANALYZE` of a Most views page for staging's largest account over a 7-day window is recorded on this ticket, read-only against staging. If the sort dominates, stop and raise it rather than adding an index: an index ends the HOT update ADR-024 depends on
