# REACH-08: Readers stop falling back to media counters

**What to build:** Once every stored Post's counters live in their columns, the REACH-01 fallback to
the media keys is removed, so the columns are the only source of a View count and its reaction
chips. See `.scratch/post-view-observations/spec.md` ("Counters on Posts") and ADR-024.

**Blocked by:** REACH-01, and the REACH-01 backfill script having run on staging. Confirm that
precondition before starting: a read-only count on staging of Posts whose media still carries a
View count or reaction chips must be zero. Staging is read-only for this check; do not run the
script there yourself.

**Status:** resolved

### Backend

- [x] The Post read path reads the three columns only; no code reads a View count or reaction chips from a Post's media
- [x] A Post whose columns are `NULL` answers `null`, never a value from media
- [x] The fallback's tests are replaced by one asserting that a leftover media key is ignored
- [x] A guard fails any module outside the parser and the Post write path that reads the counter keys from Post media, and it is mutation-tested (watched red before trusted)

### Precondition evidence

The REACH-01 backfill ran on staging on 2026-09-27 (deploy run 36312119820, commit 96fdbf6).
A read-only count afterwards found 0 Posts with `viewsCount` in media, 0 with `reactionCounts` or
`reactionsCount` in media, 0 with `views_observed_at` NULL while `retrieved_at` is set, and 489,892
with `views_count` set.

### Resolution

`post_to_camel` returns the stored media as is and the three columns alone; the
`views_observed_at` fallback to `retrieved_at` went with the media fallback. The guard is
`test_nothing_reads_the_counter_keys_from_post_media` in `backend/tests/services/test_post_counters.py`.
It excuses two reads that are not of Post media: a Directory sample's `views_of` and the prompt
formatter's top-level field.
