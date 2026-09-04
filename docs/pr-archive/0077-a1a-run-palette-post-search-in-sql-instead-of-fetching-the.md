# #77 ⚡ A1a: run palette post search in SQL instead of fetching the corpus

**State:** merged 2026-08-01 · **Branch:** `a1-server-post-readers` into `main` · **Diff:** +216 / -11 across 3 files · **Opened:** 2026-08-01

---

The palette-search row of `A1`'s table in `docs/architecture-simplification-plan.md`.

`searchPostsForPalette` pulled **every post in the selected date range** into the browser, **on every keystroke**, to display at most 50 rows.

## No new endpoint was needed

The plan called for "a bounded server search endpoint". The feed's existing `keyword` filter is already the *same predicate*, character for character:

| | |
|---|---|
| `filterPostsByTextQuery` | `text.toLowerCase().includes(q) \|\| channelName.toLowerCase().includes(q)` |
| `post_filters._keyword_clause` | `lower(text) LIKE %q% OR lower(channel_name) LIKE %q%` |

Sorting and the cap move server-side with it: `sort: "time"` is `timestamp DESC`, exactly the client's `(r, l) => r.timestamp - l.timestamp` — so slicing the top 50 of a descending array and `LIMIT 50` return the same rows.

## The parity is pinned, not assumed

`tests/api/test_palette_search_parity.py`:

- substring match, **not** prefix or word (a "better" server search would silently return fewer rows)
- matches either `text` **or** `channelName`
- case-insensitive in both directions
- newest-first
- cap applied in SQL

## A latent inconsistency found while writing them

With **no channels selected**, the old code did two different things depending on cache staleness:

| branch | behaviour |
|---|---|
| IndexedDB | looped over the channel list → returned **nothing** |
| server | omitted `channelNames` → searched the **whole corpus** |

`searchPostsForPalette` now returns early on an empty selection. Searching everything when the user has selected nothing is the wrong half of that accident to keep.

The endpoint's own behaviour is **documented in the test rather than changed** — an empty list meaning "unscoped" is correct for the feed.

`filterPostsByTextQuery` is kept and still exported: semantic/related search and the offline fallback filter arrays they already hold.

## Still open in A1

`AIContext.tsx:496` (auto-regenerate prompt assembly) and `ScraperContext.getScopedPosts`. Both touch summary generation — which the plan flags as high risk and says to do alone — and neither is unblocked by this change.

## Verification

| Check | Result |
|---|---|
| backend suite | **797 passed / 2 skipped** (+6 new) |
| frontend suite | **715 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
