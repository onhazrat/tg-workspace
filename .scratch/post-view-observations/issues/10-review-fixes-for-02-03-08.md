# REACH-10: Close the gaps a review found in REACH-02, 03 and 08

**What to build:** A review of the merged REACH-02, REACH-03 and REACH-08 against the `implement`
process (TDD at the agreed seams, then a two-axis code review) found eight defects. Two guards
excuse the whole of `services/posts.py`, which holds the feed as well as the write path. One test
takes its expected value from the constant it checks, and one cannot fail. The refresh horizon
exists twice. The initial pass refreshes counters past the horizon. And only staging proves that
the REACH-01 counter backfill ran, although REACH-08 made every deployment depend on it. None of
this changes the wire shape. See `.scratch/post-view-observations/spec.md` and ADR-024.

**Blocked by:** none

**Status:** resolved

### Guards

- [x] `tests/services/test_analysis_window_single_source.py` no longer excuses the whole of `services/posts.py`. The counter refresh's horizon comparison is excused on its own (by function, or by pinning the module's comparison count to one), so a hand-rolled Analysis window in `list_feed` or `count_posts_in_scope` fails the guard again. Mutation-tested: an added `Post.timestamp` comparison in `list_feed` goes red
- [x] `test_nothing_reads_the_counter_keys_from_post_media` in `tests/services/test_post_counters.py` no longer skips the whole of `services/posts.py`. Its write-path reads (`_post_media_from_item`, `_counter_fields`) are listed in `COUNTER_KEY_READS` by expression with a reason, so a media counter read added to a read path in `posts.py` fails. Mutation-tested: a `p.media.get("viewsCount")` in `lookup_posts` goes red

### Refresh horizon

- [x] There is one refresh horizon constant. `reach.REFRESH_HORIZON_HOURS` and `posts.COUNTER_REFRESH_HORIZON_MS` are derived one from the other, so the settling-age validation and the refresh cannot disagree
- [x] The horizon test seeds literal ages instead of importing the constant: a Post published 6 days ago is refreshed and one published 8 days ago is not. Mutation-tested: a 3-day horizon goes red
- [x] The initial pass applies the horizon too. A stored Post older than 7 days that an initial pass meets again keeps its View count, reaction chips and observation time, and a younger one is refreshed. Tested at `_apply_scrape_page` with `retrieval_pass="initial"`

### Reach

- [x] `test_reach_comes_from_the_corpus` in `tests/api/test_channel_reach.py` can fail. Either it proves something a follow-scoped read would get wrong, or it is removed and the spec's "over the corpus" line says why the two reads are the same set for a followed Channel

### Counter backfill converges everywhere

- [x] `backend/scripts/prestart.sh` runs `scripts/move_post_counters_to_columns.py` after `alembic upgrade head`, in the manner of `backfill_chat_sessions.py`: idempotent, and a no-op when no Post's media holds a counter key. Every deployment then converges without an operator step, and an export stops dropping counters that still sit in media
- [x] A test runs the script twice over a database with leftover media keys: the first run moves them, and the second changes no row
- [x] Running the script by hand still works, `--dry-run` included; `development.md` says prestart now runs it

### Docs

- [x] The spec matches what shipped (done in the PR that filed this ticket): one `reach` settings row, Reach on the Channel stats reads, and the initial-pass horizon recorded as REACH-10's to apply
- [x] Every new or changed guard and test is mutation-tested (watched red before trusted)
