# 05: The harvest marks the Post instead of walking a cursor

**What to build:** Each Post carries whether the harvest has looked at it, so the sweep is `WHERE NOT harvested` and nothing else — no marks, no wrap, no backfill leg, no ordering that can skip a row, and no cost at all once the corpus is caught up.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] `Post.harvested` is a `NOT NULL DEFAULT false` boolean, and a partial index on `(timestamp DESC) WHERE NOT harvested` serves the only query that reads it
- [ ] The sweep selects `WHERE NOT harvested ORDER BY timestamp DESC`, extracts references, and stamps exactly the rows it examined in the same transaction that enqueues the handles
- [ ] Both marks are gone: `harvestTail`, `harvestCursor`, `HARVEST_START`, `load_harvest_state`, `save_harvest_state`, `_harvest_mark`, the `directory_runtime` fields and the two `DiscoverRuntime` schema fields, with the client regenerated
- [ ] `harvest_page` loses `after` and `until`, and `HarvestPage` loses `cursor`; it returns the handles, the rows to stamp, and how many it read
- [ ] `DIRECTORY_HARVEST_BATCH_SIZE` and `DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT` are removed from `config.py` and `.env.example`; the batch is `BACKLOG_CEILING - pending`, computed from two numbers `run_directory_harvest_sweep` already reads
- [ ] `DIRECTORY_HARVEST_PAGE_SIZE` becomes a module constant, leaving `DIRECTORY_HARVEST_SCAN_LIMIT` and `DIRECTORY_HARVEST_BACKLOG_CEILING` as the job's two settings
- [ ] `deploy-staging.yml` keeps only the `DIRECTORY_HARVEST_SCAN_LIMIT=20000` override; the `BATCH_SIZE=1000` line goes, because it exceeded the ceiling it was written to respect
- [ ] `ix_tg_posts_timestamp` is **kept** — `jobs/retention.py` reads it with no channel equality
- [ ] A caught-up tick reads no Posts, and the partial index it reads is empty rather than corpus-sized
- [ ] Every property ticket 04 asserted still holds: followed handles skipped, known handles skipped, one `HARVEST_PRIORITY`, the backlog ceiling, and the deployment tally
- [ ] A new Post reaches the Directory on the next tick even with a 4.7M-row backlog unharvested

## Notes

**This ticket used to propose walking `Post.retrieved_at`.** That idea was right
about ticket 04's miss and wrong about the fix. It is written up below because
the reasoning that killed it is the reason to trust the flag.

**The pattern is already here, twice.** `jobs/translation_batch.py` and
`services/embeddings.py` both pick their next batch by anti-joining the
companion table that holds their output — `LEFT JOIN`, `WHERE companion.id IS
NULL`, `ORDER BY timestamp DESC LIMIT n`. Neither keeps a cursor. The harvest
produces no per-post output, so it has no companion table to anti-join, and the
same idea collapses to a boolean on the row. Ticket 04 invented a cursor for a
question this codebase already answers two other ways.

**Why not `retrieved_at`, the idea this ticket started as.** It is a genuine
insert stamp with a single writer, so ordering by it would see every Post once,
including one a backward sync stored under an old publish date. It fails on
ties. `bulk_upsert_posts_impl` takes `now_ms` **once per call**, and
`data_import_export.py` passes an entire import as one call, so a 100k-post
import stamps 100k rows with one identical value. A scalar cursor reads a page,
sets itself to the last row's stamp, and the next `> cursor` skips the rest of
that group permanently — with no wrap left to give them a second pass. Fixing
that needs a compound `(retrieved_at, id)` keyset cursor and a two-column index
that grows with the table forever to serve a query that reads nothing. The flag
needs neither.

`harvest_page`'s current docstring calls the straddle "stated rather than
fixed", which was fair when a tie meant two Posts in the same millisecond. Under
an insert stamp a tie is a whole batch, and the note would have been inherited
without noticing its premise had changed.

**The hazard the flag removes rather than mitigates.** Any stamp assigned in
Python before commit can diverge from commit order: a writer takes a lower stamp
and commits after the walk has passed it, and the row is skipped silently. A
lag margin makes that unlikely and cannot make it impossible, because a large
import holds one transaction open at one stamp for minutes. A row that commits
late is simply `harvested = false` and gets picked up on any later tick. The
correctness question stops existing.

**The index gets smaller over time, not larger.** `(timestamp DESC) WHERE NOT
harvested` covers exactly the unprocessed set. It starts corpus-sized, shrinks
as the backlog drains, and stays near-empty for the life of the install — the
opposite of the ordering index a cursor design has to keep forever.

**Newest-first is free, so take it.** `ORDER BY timestamp DESC` is the same line
count as no ordering and it reproduces the property ticket 04 paid the most for:
the tail leg existed so a new Post is reached promptly, and it needed a second
mark, a second budget and a wrap to coexist with the backfill leg. On the
unharvested set a new Post is at the front by construction, so one query does
both jobs. It also matches what the two existing per-post batch jobs already do.

**The early stop stops needing an argument.** Today the handle batch is checked
*between* pages and may overshoot by one page's references, because truncating
would strand handles whose Posts the mark had already moved past — a bounded
overshoot traded against unbounded loss. Stamping the rows actually examined
makes stopping mid-page ordinary, and that paragraph of `_walk` goes with it.

**What it costs, stated rather than buried.** The catch-up pass issues one
`UPDATE` per Post, 4.7M of them on staging, batched per page. TOAST pointers are
copied rather than the TOAST data, so the churn is main-heap only, and spread
across the drain it is on the order of a thousand row versions a minute — but
this repo has already paid for ignoring dead-tuple growth once (`tg_sync_meta`,
10 live rows and 4,743 dead), so it belongs in the ticket and not a footnote.
Steady state is one `UPDATE` per newly inserted Post.

It also puts a job's bookkeeping column on the system's busiest table.
`retrieval_job_id`, `retrieval_pass`, `retrieval_source` and `is_anchor` are
already there, so the precedent holds, but it is one more.

**Two settings, because the third was defeating the second.** Staging runs
`BATCH_SIZE=1000` against `BACKLOG_CEILING=600`, and the ceiling is checked
*before* the walk — so a tick starting at 599 pending ends at 1599, overshooting
by 2.6x the bound that commit `350d31b` deliberately left alone to prevent
ticket 03's refresh from starving. Deriving the batch as `ceiling - pending`
makes the two impossible to set incoherently and deletes the knob.
`SCAN_LIMIT` stays: it is the cost bound on one tick, and it is the half of the
staging override that was doing the work.

**No mark to seed, so no migration guesswork.** Every row starts unharvested and
the corpus is walked once from scratch. Preserving position would mean deriving
a flag from a `timestamp` mark — two unrelated clocks — and getting it wrong for
exactly the backward-synced Posts the sweep exists to reach. At staging's
`SCAN_LIMIT=20000` the walk covers 4.7M Posts in about 20 hours, and the real
first pass is ~4 days, bounded by the probe lane's measured ~2,340 verdicts an
hour rather than by the walk.

`ADD COLUMN harvested boolean NOT NULL DEFAULT false` is metadata-only on
PostgreSQL 11+, so the column itself is instant on 4.7M rows. Only the partial
index build takes a lock, and it takes an ordinary one: `prestart.sh` runs
migrations before the app boots, so nothing is serving and `CREATE INDEX
CONCURRENTLY` would buy a guarantee that is already free while costing a
non-transactional migration that can leave an `INVALID` index behind.

**What deliberately does not change.** A re-upserted Post whose text changed is
not re-examined; today's cursor has already passed it, so this is unchanged
rather than a regression. Anchor Posts are still harvested, unlike in the
translation and embedding jobs, because ticket 04 did not exclude them.
`directory_harvest` stays a separate job from `discover_probe`: "stop crawling
for new channels" and "stop probing the ones we have" are different operator
actions with different triggers, and folding them trades a real control for one
deleted lock.

**Not a bug fix.** Ticket 04 is shipped, correct and running on staging. This is
a simplification with a measurable payoff, so it deserves its own tests and its
own review rather than being patched onto working code.

## Comments

Raised by the user while reviewing ticket 04's settings, asking whether an insert
time would be better than the `DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT` mechanism.
It is, and the user then asked whether a per-row processed flag would be simpler
still. It is, by a wider margin: the insert-stamp walk still needed a compound
cursor for tie safety, a lag margin for the commit-order hazard, a decision about
NULL stamps and a forever-growing index, and the flag needs none of the four.
