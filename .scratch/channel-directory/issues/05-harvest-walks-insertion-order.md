# 05: The harvest walks insertion order

**What to build:** The harvest sweep follows the order Posts were *stored* rather than the order they were *published*, so every Post is seen exactly once, whenever it arrived — and the second mark, the wrapping backfill leg and its forever-cost all go away.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The walk orders by an immutable insert stamp instead of `Post.timestamp`, so a Post stored by a *backward* sync is reached by moving forward rather than by re-lapping
- [ ] One mark, not two: the backfill leg, the wrap and the `until` bound are all deleted, and the sweep becomes a plain tail-follower
- [ ] `DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT` is removed from `config.py` and `.env.example`
- [ ] A caught-up tick reads **no** Posts at all, so the steady-state cost is one empty indexed query rather than a permanent re-lap
- [ ] The cursor never advances closer than a lag margin to now, because the stamp is assigned in Python before commit and a straggler committing behind the cursor would otherwise be skipped silently
- [ ] The lag margin is configurable and its default is stated in `.env.example`
- [ ] A new index supports the walk, and `ix_tg_posts_timestamp` is dropped in the same revision unless a second reader for it has appeared
- [ ] The migration seeds the mark so an existing deployment does not re-harvest its whole corpus on the first tick after the upgrade
- [ ] A Post whose stamp is NULL is still reachable, or the migration backfills it and the column is made `NOT NULL`
- [ ] Every property ticket 04 asserted still holds: followed handles skipped, known handles skipped, one `HARVEST_PRIORITY`, the backlog ceiling, and the deployment tally

## Notes

**The column already exists.** `Post.retrieved_at` is set to `now_ms` on insert by
`bulk_upsert_posts_impl` and never touched on update, and that function is the
**only** constructor of `Post` rows in the codebase. On staging it is non-NULL for
all 4,711,236 rows. It is nullable in the model because migration
`e7f8a9b0c1d2` added it that way with no backfill, so the ticket has to decide
between tolerating NULLs and backfilling them.

**Why not `updated_at`, which is the tempting one.** Ticket 04 rejected it and
that reasoning stands: `bulk_upsert_posts_impl` bumps it unconditionally on every
re-upsert, and sync re-scrapes the newest page of every followed Channel on every
run, so thousands of rows churn to the end of that ordering per sync round. The
walk would fall permanently behind the churn and never reach genuinely new Posts.
An **insert** stamp does not churn; an **update** stamp does. Ticket 04 checked
the second and did not look for the first, which is the whole reason this ticket
exists.

**The hazard this trades for.** `retrieved_at` is assigned in Python before the
transaction commits, so commit order and stamp order can diverge: writer A takes
100, writer B takes 101 and commits first, the walker passes 101, then A commits
at 100 — below the cursor, never seen. The window is one transaction wide and the
failure is silent, which is why the lag margin is a checkbox rather than a note.
A database-assigned monotonic sequence would remove the hazard outright and is
the bigger change; decide explicitly rather than by default.

**What this is worth.** Measured on staging at ticket 04's shipped defaults, the
backfill leg re-reads history at 100 Posts/tick forever — ~29k Posts a day, for
the life of the install, to find handles that are almost all already on the map.
That is the shape `CLAUDE.md` names as "a scheduled job pays its cost every tick,
forever", made small rather than removed. This removes it.

Half of `jobs/directory_harvest.py::_collect` goes with it: the `_walk` helper
stops needing an `until` bound, `harvest_page` loses its `until` parameter, and
`load_harvest_state`/`save_harvest_state` return to a single value.

**Not a bug fix.** Ticket 04 is shipped, correct and running on staging; nothing
is broken. This is a simplification with a measurable payoff, so it deserves its
own tests and its own review rather than being patched onto working code.

## Comments

Raised by the user while reviewing ticket 04's settings, asking whether an insert
time would be better than the `DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT` mechanism.
It is. Verified the same session: `retrieved_at` is written on insert only, has a
single writer, and is 100% populated on staging.
