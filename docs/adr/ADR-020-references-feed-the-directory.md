# ADR-020: References feed the Directory

**Status:** Accepted (2026-09-23). Supersedes the part of
[ADR-019](./ADR-019-channel-reference-graph.md) that has the harvest sweep read handles out of
Posts itself, and its claim that nothing reads `tg_post_references`. Builds on
[ADR-014](./ADR-014-channel-directory.md).

## Context

The harvest sweep fills the Directory queue on its own. Until now it walked the stored Posts with
its own progress flag (`Post.harvested`), pulled handles out with `discover.post_references`, and
queued the ones the Directory did not hold. Stored Posts exist only for followed Channels, so the
Directory stopped one hop from the follows.

ADR-019 then added a second walk over the same Posts. Reference extraction reads them with a
sibling extractor, held by a test to the same handles, and writes every Reference to
`tg_post_references`. It also mines Directory samples, which come from Channels nobody follows.
So the graph held every handle the harvest found, and one hop more. Nothing queued that hop.

On staging on 2026-09-23 the graph named 335 targets with no Directory entry, and every one came
from a sample. None came from a followed Post, because the harvest had already queued those.

## Decision: the graph is the Directory's only feeder

Each harvest tick runs reference extraction, then queues every Reference target that has no
Directory entry and that nobody follows, up to the existing backlog ceiling. The harvest's own
Post walk, its scan limit and the functions behind it are deleted. `Post.harvested` is dropped in
a later change (DDS-03), once staging shows the Directory kept growing without it.

This makes the crawl recursive at no Telegram cost beyond the probes it queues: a queued handle is
probed, its samples name more handles, the next tick queues those. The existing refresh re-probes
every live entry every `directoryRefreshDays`, so each refresh brings in what that Channel cited
since.

The query is an anti-join computed every tick, newest Reference first, the order the Post walk
had: a handle a Post named a moment ago is queued on the next tick even while a backlog larger than
the budget is outstanding. `PostReference.id` is a random UUID, so there is no cursor to resume
from, and a caught-up tick reads the whole table. Measured on staging on 2026-09-23: 19 ms over
79k References (21 MB), every 300 s. A cursor column waits until `pg_stat_statements` says the
tick is costly.

## Consequences

**A Post whose Channel has no chat id delays its handles.** Reference extraction defers such a
Post for `POST_REFERENCE_CHAT_ID_GRACE_DAYS` and then gives up on it, because a Reference is keyed
by the source's chat id (ADR-019 Decision 2). The Post walk needed no chat id, so this is a real
loss: those handles now reach the Directory late, or never. Accepted, because it is small (3 of
272 followed Channels on staging lack a chat id, and every live Directory entry has one) and
because the fix for a missing chat id is getting the chat id, not a second extractor.

ADR-019 kept the two flags apart partly because one chat-id-less Channel with a recent backlog
would have stalled a newest-first walk for the whole grace period. That stall does not come back.
The enqueue has no walk and no order to stall; a deferred Post delays only its own handles.

**An edited Post goes back to extraction.** The Post upsert already sent a Post whose references
changed back to the harvest. It now clears `references_extracted` too, since extraction is the
only reader left.

**The crawl has no depth bound.** Its rate is bounded by the backlog ceiling, by the probe lane
running only when no sync lane has work, and by the adaptive per-proxy wait. Its cost shows up in
`tg_directory_probe_usage` and in sync's soft-block rate. `DIRECTORY_FOLLOW_SAMPLE_REFERENCES`,
default on, turns the sample source off, which queues exactly what the Post walk used to.

Every queued handle takes the existing harvest priority, whatever its source.

## Alternatives considered

**Enqueue inline in `record_probe_result`.** The probe already has the samples in hand. Rejected:
a handle the ceiling turned away would be gone until the next refresh, and it would leave two
feeders, the Post walk and the probe, for one queue.

**Keep the Post walk beside the new source.** Two extractors deciding what the Directory learns is
the drift ADR-019's parity test exists to catch, for no gain once the graph holds a superset.

**A depth cap (hop count from the nearest followed Channel).** Deferred. Stored at enqueue it goes
stale as follows change; derived per tick it adds a join per hop. The switch already gives a cap of
one. Add a cap if probe usage stays pinned or sync soft blocks rise.

**Deep pagination of unfollowed Channels.** The original proposal: walk their older history on a
lane behind the probe lane. Parked. It is the one option that adds fetches, and the recursive
crawl should be measured first.
