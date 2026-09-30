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

**Status:** done

### The Scope

- [x] The Scope's filter half gains two fields and two orders (shape settled in the grilling):

  ```
  view_measure: "views" | "estimated"            # default "estimated"
  views:        { op: "gte" | "lte", value: int } | null
  sort:         "newest" | "oldest" | "most_views" | "fewest_views"
  ```

- [x] A Scope stored before this ticket reads with `view_measure: "estimated"` and `views: null`, which filters nothing and changes no order
- [x] Unknown values are refused with a 422

### The Estimated View count

- [x] A Post at least the settling age old has its View count as its Estimated View count
- [x] A younger Post observed at or after the estimation floor has its View count divided by the current Settling curve's share at its age when observed; the current curve is the newest fit, or the seed curve before the first
- [x] A Post younger than the estimation floor, or with no View count, has none
- [x] The server computes it per request as an SQL expression from the current curve and the reach settings; nothing is stored and `views_count` gets no index
- [x] The browser has a twin for semantic results, fed the current curve and settings by the server
- [x] One shared fixture table of (View count, age, curve, settings) to expected Estimated View count, covering the seed curve, a fitted curve, the settling-age boundary and the estimation floor, is asserted against the Python reach function, the SQL expression and the browser twin

### Behaviour, end to end

- [x] A views threshold keeps Posts whose value under the selected measure is at least (`gte`) or at most (`lte`) the number; a Post with no value never matches
- [x] Most views and Fewest views order by the selected measure even with no threshold set, with Posts that have no value last in both directions and the existing stable tiebreak after
- [x] The per-channel cap, grouping and paging all follow the views orders as they follow the time orders
- [x] The counts route answers `{counts: {channel: n}, tooNewToJudge: n}`, where `tooNewToJudge` counts the Posts an Estimated views threshold hid for being under the estimation floor, as one more filtered aggregate in the query that already runs. The service the AI paths call to size a selection keeps answering the per-channel map
- [x] Summary, Chat, Tag and Discover honour the threshold and the views orders, and the Artifact's frozen Scope records the measure, threshold and order
- [x] Semantic results obey the threshold and the views orders through the browser twin

### The bar

- [x] A **Views** pill sits after Language. It reads `Any`, or `Popular, 10K views` / `Niche, 1K views` on Views and `Popular, 10K est. views` on Estimated views
- [x] Inside: two underline tabs, **Views** ("What Telegram shows now. Young posts read low.") and **Estimated views** ("What a post's views are expected to settle at. Posts under 3 hours are too new to judge."), Estimated views selected by default; two cards, **Popular** (at least this many) and **Niche** (at most this many); the number box with the word "views" and a Clear link, accepting `25000`, `25k`, `2,500` or `1.5M`; and a slider snapping on a log scale to 100, 250, 500, 1K, 2.5K, 5K, 10K, 25K, 50K, 100K, 250K, 500K, 1M, showing the nearest step for a typed number
- [x] The **Order** pill adds Most views and Fewest views
- [x] The **Per channel** pill and first card follow them: `Top 10 by views`, "The 10 with the most views"; `Bottom 10 by views`, "The 10 with the fewest views"
- [x] The footer adds "N too new to judge" when the counts report any
- [x] The measure and threshold are remembered in the per-account scoped browser storage with the other filters

### Tests and measurement

- [x] The feed over HTTP, with two live accounts: both measures at both directions, including a Post with no View count and a Post under the estimation floor; both views orders with nulls last; the cap and grouping under a views order; `tooNewToJudge`; 422s. Prior art: the existing feed tests
- [x] The shared estimate fixture passes against all three implementations, and each is watched failing against a deliberately wrong curve
- [x] The Scope record carries the measure, threshold and order through an Action to its Artifact. Prior art: the frozen-scope tests
- [x] Semantic parity for the threshold and the views orders. Prior art: the post-view pipeline tests
- [x] `EXPLAIN ANALYZE` of a Most views page for staging's largest account over a 7-day window is recorded on this ticket, read-only against staging. If the sort dominates, stop and raise it rather than adding an index: an index ends the HOT update ADR-024 depends on

## Comments

**2026-09-30, implementation notes.**

- **The curve is data now.** `reach.CurvePoints` is the seed's steps or a
  fit's knots, callable so it is still a `Curve` everywhere one was taken.
  `settling_curve.current_curve` returns one, and `settling_curve.view_reading`
  is the one loader of "what views means for this request": the curve and the
  reach settings, read only when a threshold or a views order will use them.
- **Three copies, one fixture.** `reach.estimated_views` (which Reach's
  corrected counts now go through), `post_filters.estimated_views_sql` and
  `frontend/src/lib/posts/estimated-views.ts` are all asserted against
  `backend/tests/fixtures/estimated_views.json`, whose numbers were computed by
  hand. Each file also runs the fixture against a deliberately wrong curve and
  requires a mismatch. The frontend unit workflow now triggers on the fixture.
- **Age is age at observation**, `views_observed_at - timestamp`, as Reach
  reads it. A Post observed only while young stays too new to judge until sync
  sees it again, however old it is now.
- **`tooNewToJudge`** is a Post with a View count observed under the
  estimation floor, counted only under an Estimated views threshold. The
  threshold moves from the counts query's `WHERE` into a `FILTER`, so the rows
  it hides are still in the scan to be counted. It is not clamped to the cap.
  `count_posts_in_scope` (what the AI paths size a selection by) still answers
  the map; `count_scope` answers both.
- **The browser gets the curve from `GET /data/posts/view-estimate`**, fetched
  through the query cache (an hour stale) only when a meaning search needs an
  estimate. With no curve loaded, an estimate is none rather than a guess. A
  meaning search reports no too-new count; the footer shows it only for the
  server feed.
- **The feed request carries `viewMeasure` only when it is `views`**, the
  server's default being `estimated`, and `views` only when set.
- **Palette.** The four orders come from `POST_ORDER_OPTIONS`, so the palette
  gained Most and Fewest views with no new code; "clear post filters" resets
  the measure and the threshold.

**2026-09-30, acceptance measurement (read-only, staging).** Run inside
`BEGIN READ ONLY ... ROLLBACK` against `tg-summarizer-staging-db-1`, with the
SQL `list_feed` compiles for a Most views page (limit 20, offset 0) under the
seed curve. The largest account follows 279 Channels; its 7-day window holds
**38,195 Posts**.

| Page | Execution | Sort |
|------|-----------|------|
| Most views, Estimated, no threshold | 129 ms (cold: 24k buffers read) | top-N heapsort, 72-93 kB per worker, ~6 ms of the 107 ms per worker |
| Most views, Estimated, at least 1K | 56 ms (warm) | top-N heapsort, 82-100 kB per worker |

The plan is a parallel bitmap heap scan on `ix_tg_posts_timestamp`, a hash
semi join on the Follow, then the sort. The heap scan dominates (fetching the
window's rows); the sort is a top-N heap over the Scope's rows and does not.
**No index added**, so the counter refresh stays a HOT update (ADR-024).
