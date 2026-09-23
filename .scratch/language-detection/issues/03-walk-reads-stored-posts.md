# LANG-03: The walk reads stored Posts

**What to build:** Posts stored before LANG-01 gain a Language without anyone running a script on a
deployment. A scheduled job on the Sync worker reads unread Posts newest first, a bounded batch per
tick, and relabels the Channels whose Posts it read, so the Channels tab fills in as the backfill
proceeds. Once it catches up it keeps running at next to no cost. See
`.scratch/language-detection/spec.md` and ADR-021.

**Blocked by:** LANG-02.

**Status:** resolved

- [x] A scheduled job on the Sync worker (never the API process) reads a bounded batch of unread Posts per tick, newest first, through the unread partial index
- [x] It writes their Languages in batched updates, then re-derives the touched Channels through the LANG-02 derivation
- [x] The batch size is an integer setting documented in `.env.example`, with a default sized like the harvest and reference-extraction batches, and the defaults guard covers it
- [x] A caught-up tick finds nothing and writes nothing
- [x] No manual `VACUUM` step is required; the batch size keeps dead-tuple creation at a pace autovacuum reclaims
- [x] Tests cover: newest Posts read first; the batch bound respected; touched Channels relabelled; a caught-up tick is a no-op

## Comments

Delivered on branch `worktree-lang-03-walk`. Where it differs from the text above:

- The walk is its own scheduler job, `post_language`, rather than a step in the harvest tick the
  way reference extraction is. Nothing downstream reads what it writes on the same tick, and a job
  of its own can be paused from `PUT /jobs/post_language` without touching the Directory crawl.
  `POST /jobs/post_language/trigger` asks the worker over `NOTIFY` like every job, so the walk
  never runs in the API process.
- Its interval is a module constant (300 s, the harvest's cadence), not a setting.
  `POST_LANGUAGE_WALK_BATCH_SIZE` (10,000, like `POST_REFERENCE_SCAN_LIMIT`) is the one dial.
- Each `UPDATE` keeps `language IS NULL` in its predicate, so a Post that sync edited and read
  while the walk held the page keeps the answer about its newer words.
- The walk does not move the `posts` etag. The Channels tab fills in through `relabel_channels`,
  which moves `channels`; an open feed picks up Post Languages on its next ordinary refetch.
