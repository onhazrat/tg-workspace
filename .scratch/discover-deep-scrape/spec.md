# References feed the Directory

Status: ready-for-agent

Settled by DDS-01 (`issues/01-triage-open-questions.md`). This spec replaces the earlier
"deep-scrape discovered channels" draft; that idea is parked under Further Notes.

## Problem Statement

The Directory only grows one hop out from what somebody follows. The harvest sweep finds new
handles by walking stored Posts, and stored Posts exist only for followed Channels. A Discovery
probe of an unfollowed Channel already fetches and parses a page of that Channel's recent Posts,
and since CRG-02 those samples are mined for References, but no handle a sample names ever
reaches the Directory queue. On staging (2026-09-23) 335 distinct Reference targets had no
Directory entry, and every one of them came from an unfollowed source.

So the deployment pays for the fetch, records who cites whom in `tg_post_references`, and then
throws away the discovery the fetch made possible. The operator sees a Directory that stalls
once the followed corpus is exhausted, however much idle Telegram capacity is left.

There are also two extractors feeding one question. The harvest re-reads Posts with its own flag
(`Post.harvested`) to pull handles out, while reference extraction reads the same Posts with
another flag (`Post.references_extracted`) to write References that already contain those handles.

## Solution

The References table becomes the Directory's only feeder. Each harvest tick, after reference
extraction has run, the sweep enqueues every Reference target that has no Directory entry and
that nobody follows, up to the existing backlog ceiling. That covers both sources of References:
followed Posts, as today, and Directory samples, which is new.

The crawl becomes recursive with no extra Telegram requests beyond the probes it queues. A
followed Channel cites a handle, the handle is probed, its samples cite more handles, those are
probed, and so on. The existing Directory refresh (every `directoryRefreshDays`, default 7)
re-probes every live entry, so each refresh brings in the handles that Channel cited since, and
discovery keeps going on its own.

The rate is bounded by what already exists: the backlog ceiling, the probe lane's position
behind every sync lane, and the adaptive per-proxy wait. One setting turns the sample source off,
which reproduces today's behaviour exactly.

## User Stories

1. As an Operator, I want handles named in an unfollowed Channel's samples to be queued for probing, so that the Directory grows past one hop from what my Accounts follow.
2. As an Operator, I want the crawl to continue from each newly probed Channel, so that discovery is recursive without anybody running a Discovery report.
3. As an Operator, I want discovery to cost no Telegram requests beyond the probes it queues, so that the only new traffic is the traffic I can see in the probe usage tally.
4. As an Operator, I want every Directory refresh to bring in the handles that Channel cited since its last probe, so that a quiet Channel that starts posting again feeds discovery again.
5. As an Operator, I want one switch that stops sample-sourced targets being queued, so that I can return to today's behaviour immediately if probe traffic hurts sync.
6. As an Operator, I want that switch to default on, so that a new deployment discovers beyond its follows without configuration.
7. As an Operator, I want the switch off to queue exactly what the harvest queues today, so that turning it off is a true rollback and not a third behaviour.
8. As an Operator, I want queued handles to stop at the existing backlog ceiling, so that Directory refresh is never starved by an endless stream of new finds.
9. As an Operator, I want a handle the sweep skipped at the ceiling to be queued on a later tick, so that a full queue delays discovery and never loses a handle.
10. As an Operator, I want handles somebody follows to be skipped, so that a Channel sync already describes is never probed a second time by another route.
11. As an Operator, I want handles that already have a Directory entry to be skipped whatever their verdict, so that re-finding a known handle is not counted as new work.
12. As an Operator, I want a Channel never to queue itself, so that self-references do not reach the Directory.
13. As an Operator, I want a forward, a mention, a link and a cross-channel reply to reach the Directory the same way they do today, so that the switch of source changes who asks and not what counts.
14. As an Operator, I want a Post whose edit adds a `t.me` link to send that new handle to the Directory, so that an edited Post is not a dead end.
15. As an Operator, I want a newly stored Post's handles to reach the Directory on the same tick its References are extracted, so that the queue is not a tick behind the graph.
16. As an Operator, I want every queued handle, whatever its source, to carry one priority behind a Discovery report's candidates and ahead of refresh, so that a report I asked for still drains first.
17. As an Operator, I want one Account's corpus not to starve another's in the queue, so that fairness holds as it does today.
18. As an Operator, I want a reference-extraction failure not to stop the sweep from queueing what the table already holds, so that one fault does not silently halt discovery.
19. As an Operator, I want two ticks never to overlap, so that the same handle is not queued twice by concurrent sweeps.
20. As an Operator, I want the tick's summary to report how many handles it queued and the pending backlog, so that the job dashboard still says what the sweep did.
21. As an Operator, I want a tick that finds nothing new to cost only a cheap query, so that a caught-up deployment pays almost nothing per tick.
22. As an Operator, I want the scan-limit setting that bounded the old Post walk to disappear, so that `.env.example` does not document a knob that no longer does anything.
23. As an Operator, I want the job's existing name, enable switch and dashboard flag to keep working, so that stored job settings survive the change.
24. As a maintainer, I want one extractor to answer "which handles does the Directory learn about", so that the queue and the graph can never disagree about what a Post references.
25. As a maintainer, I want the reasoning for replacing the harvest walk recorded in an ADR next to ADR-019, so that a future reader knows why the two flags became one.
26. As a maintainer, I want the `Post.harvested` column dropped only after staging shows the Directory kept growing without it, so that the irreversible step waits for evidence.
27. As a maintainer, I want the Discovery report's own use of `discover.post_references` left untouched, so that this change does not alter report counters.

## Implementation Decisions

- **The sweep's source changes and nothing else about the job does.** The job keeps its name, its tick interval, its lock, its enable switch, its dashboard flag, its priority constant and its backlog ceiling (`DIRECTORY_HARVEST_BACKLOG_CEILING`, 3000). Only the step that finds new handles is replaced: instead of walking unharvested Posts, it reads distinct Reference targets.
- **Order within a tick is unchanged.** Reference extraction runs first and unconditionally. The ceiling check runs next and skips the rest of the tick when the backlog is full. The new enqueue step runs last, with a budget of `ceiling - pending`, as the Post walk did.
- **The enqueue query is an anti-join computed every tick.** It selects targets from `tg_post_references` that have no Directory entry and that no Account follows, newest Reference first (the order the Post walk had, so a new Post's handles are prompt under a backlog). There is no cursor, because `PostReference.id` is a random UUID; 19 ms over staging's 79k References. Marked with a `ponytail:` note naming the ceiling (the scan grows with the table) and the upgrade path (a cursor column, once `pg_stat_statements` shows the tick is costly).
- **One priority for every source.** Every handle this sweep queues takes the existing harvest priority, behind a report's candidates and ahead of refresh. A separate rung for sample-sourced targets was considered and deferred until two sources actually need telling apart.
- **The sample source has a switch.** A new boolean setting, `DIRECTORY_FOLLOW_SAMPLE_REFERENCES`, default on. When off, the query only considers References whose source Channel somebody follows, which is the same set the Post walk found. It goes into `.env.example` and the env catalog like every other setting; the env-example guard applies.
- **No depth bound.** A hop-count (Distance) cap was considered and rejected for now. The crawl is bounded by the backlog ceiling, the probe lane running only on spare capacity, and the adaptive per-proxy wait. The cost is observable in the existing daily probe usage tally and in sync's soft-block rate. A Distance cap is the next step if either rises, and a Distance cap of 1 is what the switch already gives.
- **Refresh is unchanged.** Every live `ok` entry is re-probed every `directoryRefreshDays` (default 7). No code change; it starts feeding discovery once samples' References are enqueued. Staging holds 2,370 live entries, about 340 refresh probes a day.
- **An edited Post goes back to reference extraction.** Today the Post upsert resets `harvested` when a reference-bearing field changes (text, forward attribution, links, reply target), and leaves `references_extracted` alone. With the harvest walk gone, that reset must also clear `references_extracted`, or an edit adding a link never reaches the Directory. The References table's uniqueness absorbs the overlap on re-extraction.
- **The chat-id deferral is accepted.** Reference extraction defers a Post whose source Channel has no chat id for `POST_REFERENCE_CHAT_ID_GRACE_DAYS`, then gives up on it, so such a Post's handles reach the Directory late or never. On staging 3 of 272 followed Channels lack a chat id, and every `ok` Directory entry has one. The fix for a missing chat id is getting the chat id, not a second extractor.
- **Deleted in this effort:** the harvest's Post walk (`harvest_page`, `mark_harvested`, the known-handles lookup if nothing else uses it) and `DIRECTORY_HARVEST_SCAN_LIMIT`. `discover.post_references` stays, because Discovery reports use it, and so does the test asserting it and the graph's extractor agree.
- **Deleted in a later ticket (DDS-03):** the `Post.harvested` column, its partial index, and the upsert's reset of it. This one is a migration, so it waits for staging evidence.
- **ADR-020** records that References feed the Directory and supersedes ADR-019's statement that the harvest sweep does, including the Q7 trade-off.
- **No glossary change.** "Harvest" is not a `CONTEXT.md` term, and Directory, Directory entry and Reference already mean what this spec uses them for.

## Testing Decisions

- **One seam: the sweep tick** (`run_directory_harvest_sweep`). Every behaviour is asserted by running a tick and reading the Directory queue afterwards. Inputs are created through the real write paths only: Posts through the Post upsert, samples through `record_probe_result`. No test seeds `tg_post_references` rows by hand, so extraction and enqueue are exercised together, the way production runs them.
- A good test here names an Operator-visible outcome ("a handle an unfollowed Channel's sample names is queued") and never asserts on the query's shape, except for the one plan test below.
- **Prior art is the existing harvest suite**, which already covers a forward, a mention and a link reaching the Directory, self-references, followed handles, known handles, cross-Account fairness, the backlog ceiling, refresh draining once the backlog clears, overlapping ticks and a tick that dies mid-walk. Keep every test whose outcome still holds, rewritten to the new source. Delete the tests about the Post walk itself (walk order, scan limit, `harvest_page` pagination, marking), because the thing they guard no longer exists.
- **New tests:** a sample-sourced target is queued; with the switch off it is not, and the queued set equals what a followed-Post-only run queues; a probe of a newly queued handle feeds the next tick (two hops); an edit that adds a link is queued on the next tick; a handle skipped at the ceiling is queued once the backlog drains; a reference-extraction failure still lets the enqueue run.
- **Newest first** is asserted by the restored prompt-Post test. An index-plan test was tried and dropped: the newest-first shape aggregates, so the index no longer bounds its cost, and the staging measurement stands in for it.
- **Mutation-test the new guards** before trusting them, per CLAUDE.md: invert the switch, drop the followed-handle exclusion, remove the edit reset, and watch each go red.

## Out of Scope

- Deep pagination of unfollowed Channels (the original DDS idea). Parked; see Further Notes.
- A Distance cap, a separate priority rung for sample-sourced targets, and ranking the queue by how many Channels cite a handle. Each is the next step if measurement asks for it.
- Any UI, route or reader of `tg_post_references` beyond this sweep.
- Changing refresh cadence.
- Anything CRG-01 to CRG-04 settled: Reference shape, chat-id identity, permanence, tenancy.

## Further Notes

- **Unexplained on staging:** 325 Directory entries, created 2026-09-12 to 2026-09-20 (before the reference graph's epoch on 09-21), have no Reference naming them and are not followed. The likely cause is that their source Posts were pruned by retention before the CRG-04 backfill ran. DDS-02 confirms that before deleting the Post walk; a divergence between the two extractors would change the plan.
- **Deep pagination, parked.** Walking an unfollowed Channel's older history (the pagination sync uses) on a non-sync lane behind the probe lane, without writing to `tg_posts`. Revisit only if the recursive crawl plateaus while the probe lane sits idle.
- ADR-019 "Decision 2" (chat-id identity) is why sample References need the source entry's chat id; staging shows every live entry has one.
