# REACH-01: View counts and reaction chips become Post columns

**What to build:** A Post's View count, its reaction chips and the time they were observed move out
of its media JSON into three columns on `tg_posts`, so that later tickets can refresh them in place.
The feed, export and import read and write the columns. A batched post-deploy script copies the
counters of existing Posts out of media and strips the media keys, and until it has run the readers
fall back to the media keys, so the feed never shows a blank View count. See
`.scratch/post-view-observations/spec.md` ("Counters on Posts") and ADR-024, which supersedes the
storage part of ADR-023.

**Blocked by:** none.

**Status:** resolved

### Backend

- [x] An Alembic revision adds three nullable columns to `tg_posts`: an integer View count, a jsonb list of reaction chips in the existing `{emoji | customEmojiId, count, isPaid}` shape, and a millisecond observation time; `NULL` means "the page showed none", never zero. Grep for a duplicate revision id before trusting "Multiple head revisions"
- [x] The same revision sets `fillfactor = 90` on `tg_posts`; none of the three columns is indexed, so a later refresh can be a HOT update
- [x] The parser keeps producing the counters inside media; the Post write path is the one place that lifts them out into the columns, and newly stored media carries neither key
- [x] A new Post's observation time is its retrieval time
- [x] The paid Stars chip stays a distinct chip with `isPaid` set, never merged into emoji counts; the reaction total is never stored
- [x] Directory samples keep their counters inside media, because a sample is written once and never refreshed
- [x] The Post response exposes `viewsCount`, `reactionCounts` and `viewsObservedAt` at the top level, not inside `media`
- [x] Until the backfill has run, a Post whose columns are `NULL` answers with the View count and chips still in its media keys, and its observation time falls back to `retrieved_at`; a Post with neither answers `null`
- [x] Export carries the three fields on each Post; import accepts only the new shape (no export in the old shape exists)
- [x] A batched script in `backend/scripts/` (the `strip_media_display_counters.py` pattern: batches, `--dry-run`, idempotent, never inside the migration) copies media's View count and chips into the columns, sets the observation time to `retrieved_at`, and strips the two media keys; it is indexed in `development.md`
- [x] Script tests: a Post with both counters, one with only a View count, one with neither, and a second run that changes nothing
- [x] The export coverage guard, the Post projection guards (`test_*_projection.py`) and the account-isolation probes are updated, not deleted
- [x] The client is regenerated (`bash scripts/generate-client.sh`)

### Frontend

- [x] The two readers of `media.viewsCount` and the reaction-chip readers (`PostCardMedia.tsx`, `lib/posts/post-media.ts`, `types.ts`) read the top-level `viewsCount` and `reactionCounts`
- [x] `types.conform.ts` and `client-split.conform.ts` are updated, not loosened
- [x] Unit tests cover a Post with counters, one with `null` counters, and a paid chip rendered apart from the emoji chips (the frontend renders no reaction chips at all, so the paid chip is pinned where it is stored instead: `backend/tests/services/test_post_counters.py`)
- [x] Every new guard and test is mutation-tested (watched red before trusted)
