# Channel counters and View counts as integers

Decision: [ADR-023](migration/ADR-023-counters-are-numbers.md). Settled in a grilling session on
2026-09-24; every question below was answered, none assumed.

## Decisions

| # | Question | Answer |
|---|---|---|
| Q1 | Replace the string or add a twin | Replace; the five columns become `integer` |
| Q2 | Absent vs zero | Nullable; `NULL` = page showed no counter |
| Q3 | Wire format | `int \| null` everywhere, client regenerated, UI formats |
| Q4 | Display | `Intl.NumberFormat("en", {notation: "compact", maximumSignificantDigits: 3})` |
| Q5 | Unparsable value | Store `NULL`, log a warning, never fail the sync |
| Q6 | Existing column rows | Convert in the migration; raise on any non-null parse failure |
| Q7 | Old export files | None exist; import takes ints only |
| Q8 | Scope | The five columns **and** Post media `views`/`reactions` and Summary `cited_posts` copies |
| Q9 | Record | `CONTEXT.md` gains Channel counters and View count; ADR-023 |
| Q10 | Views key | Keep `viewsCount`, drop `views` |
| Q11 | Reactions string | Drop `reactions`, render chips from `reactionCounts` |
| Q12 | Views in LLM prompts | Compact form through the same formatter |
| Q13 | Rewriting ~1.1M JSON rows | Batched script in `backend/scripts/` with `--dry-run`, run after deploy |
| Q14 | Recorded sync-log payloads | Not rewritten; they age out on retention |

## Staging facts (2026-09-24, read-only)

- `tg_channels`: 270 non-null subscribers (12 plain, 258 abbreviated), 0 unparsable.
- `tg_channel_directory`: 43,139 non-null subscribers (28,550 plain, 14,642 abbreviated), 0
  unparsable. The other four counters match the same pattern at 100%.
- Every Post (473,725) and Directory sample (639,859) that has `views` also has `viewsCount`, and
  every one with `reactions` has `reactionCounts`.

## Steps

1. Backend models, schemas and the scraper write integers via `parse_abbreviated_count`; the
   Alembic migration converts both tables' five columns with a SQL parse that raises on failure.
2. `post_media_parser` stops writing `views`/`reactions`; `PostMedia` drops both fields.
3. Regenerate the client. Frontend gets one `formatCount` helper used by `ChannelCard`, the Discover
   panel, `PostCard` and `post-media.ts` prompts; sorting reads the integer and
   `parseSubscriberCount` is deleted.
4. `backend/scripts/strip_media_display_counters.py` removes `views`/`reactions` from
   `tg_posts.media`, `tg_channel_directory_samples.media` and `tg_summary_payloads.cited_posts` in
   batches, `--dry-run` first.
5. Tests: the migration's parse (plain, K, M, NULL, a failure), the formatter round trip against
   staging-shaped values, and the scraper storing `NULL` on an unparsable counter.
