# Channel reference graph

Status: ready-for-agent

## Problem statement

The deployment already sees every connection between Telegram channels and throws
all of it away.

Every time a Post forwards from another channel, mentions a handle, links to a
`t.me` post or replies across channels, `discover.post_references` extracts that
fact. Two callers consume it. A Discovery report aggregates it into per-candidate
counters and keeps only the newest naming Post. The harvest sweep reads the
handles, checks whether the Directory already holds them, and discards
everything else, including which Post named what.

So the deployment can answer "how many of the Posts in my current Scope named
@foo" and nothing else. It cannot answer:

- Which channels does @foo forward from, and how often?
- Who references @foo, when nobody here follows @foo?
- Did these two channels start referencing each other around the same date?
- Which exact Post carried this reference, so I can go read it?

The last one matters most in practice. An Operator looking at a Discovery
candidate gets a count and one sample Post. The evidence behind the count is
gone, so the count is not auditable and the relationship is not explorable.

There is a second, quieter loss. Discover probes unfollowed channels and stores
a snapshot of their recent Posts as Directory samples. Those Posts carry
references exactly as corpus Posts do, and nothing has ever read them for
references. That is a corpus of connection data the deployment has already paid
Telegram requests for and never mined.

## Solution

Store every Reference as a row.

A Reference is one Post naming one Channel, once, in one way. A Post that links
to two different channels produces two References. A Post that forwards from
@foo and also mentions @foo produces two References, because the kinds differ.

The rows are written from two places that cost no additional Telegram requests:
the stored corpus (via a sweep over Posts, as the Directory harvest already
walks them) and Directory samples (at probe time, from Posts already fetched).

The table is permanent. It is never pruned, so a Reference learned in 2025
survives the retention sweep that deletes the Post it came from. That is
deliberate: the graph is the durable artifact, the corpus is the ephemeral one.
The `t.me/<handle>/<post_id>` link in the row still resolves against Telegram
long after the local copy is gone.

Identity is the numeric Telegram chat id, not the handle, because handles are
reusable and chat ids are not. A channel that renames keeps its References.

Nothing reads the table in this pass. No routes, no UI. The table fills, and the
surface gets designed against real data rather than against a guess.

## User stories

1. As an Operator, I want every reference between two channels stored as its own
   row, so that the connection graph is a thing I can query rather than a number
   recomputed per report.
2. As an Operator, I want a Reference to name the exact Post that carried it, so
   that I can open the Post on Telegram and judge the connection myself.
3. As an Operator, I want a Post that names two channels to produce two
   References, so that the row count is the number of actual connections and not
   the number of Posts.
4. As an Operator, I want a Post that both forwards from and mentions the same
   channel to produce two References, so that the kind of connection is never
   silently collapsed.
5. As an Operator, I want References mined from Directory samples as well as from
   the corpus, so that channels nobody follows still contribute to the graph.
6. As an Operator, I want sample mining to spend no additional Telegram requests,
   so that a richer graph does not cost quota.
7. As an Operator, I want a Reference to survive the deletion of the Post that
   produced it, so that shortening the retention window does not erase the
   deployment's accumulated knowledge.
8. As an Operator, I want a Reference to carry the timestamp of its source Post,
   so that I can order the graph in time without joining a table whose row may be
   gone.
9. As an Operator, I want References keyed by chat id rather than handle, so that
   a channel that renames itself does not appear as two unrelated nodes.
10. As an Operator, I want a Reference to carry the source handle as well as the
    chat id, so that a `t.me` link can be built without a join.
11. As an Operator, I want the target's chat id recorded when the deployment
    already knows it, so that the target end of the edge is rename-proof too.
12. As an Operator, I want a target the deployment has never probed to still
    produce a Reference, so that the graph records connections to channels we
    know nothing about yet.
13. As an Operator, I want re-running the backfill to add zero rows, so that a
    correction pass or an interrupted run is safe to repeat.
14. As an Operator, I want a re-probe of the same channel to add zero duplicate
    References, so that a channel refreshed weekly does not multiply its rows.
15. As an Operator, I want a cross-channel reply recorded as its own kind, so
    that "replied to" is distinguishable from "linked to" in the graph.
16. As an Operator, I want a same-channel reply to produce no Reference, so that
    the graph holds connections between channels and not self-loops.
17. As an Operator, I want the graph's notion of a reference to stay identical to
    the one Discovery reports use, so that the two never quietly disagree about
    what counts.
18. As an Operator, I want a forward to record which Post in the source channel
    it came from, so that a forward is as explorable as a link.
19. As an Operator, I want to know that forwards scraped before this change can
    never gain that detail, so that I do not wait for a backfill that cannot
    exist.
20. As an Operator, I want References from a channel whose chat id is not yet
    known to be retried for a grace period, so that a transient gap does not
    permanently lose that channel's connections.
21. As an Operator, I want that retry to give up after a bounded time, so that a
    channel that never yields a chat id does not accumulate work forever.
22. As an Operator, I want to see how many Posts were skipped for want of a chat
    id, so that a silent gap in the graph is visible.
23. As an Operator, I want the grace period to be measured from deployment rather
    than from the Post's own date, so that the entire existing corpus gets a
    real grace window instead of expiring instantly.
24. As an Operator, I want the grace period to be a tunable setting, so that I
    can widen it without a code change.
25. As an Operator, I want reference extraction to have its own progress flag, so
    that it cannot starve the Directory harvest it runs beside.
26. As an Operator, I want the first pass over the existing corpus to run as a
    script I invoke, so that a deployment does not stall on a multi-million-row
    update while the service is down.
27. As an Operator, I want that script to support a dry run, so that I can see
    what it would write before it writes anything.
28. As an Operator, I want the script and the scheduled sweep to share their
    logic, so that the backfill cannot behave differently from steady state.
29. As an Operator, I want the graph indexed for the reverse question, so that
    "who references @foo" is answerable the day the first consumer is written.
30. As an Account, I want the graph to hold no record of who follows what, so
    that a shared corpus artifact stays free of personal data.
31. As an Operator, I want a manual Directory recheck to keep the channel's
    remembered chat id, so that asking for a refresh does not blind the graph.
32. As a developer, I want the table classified in the tenancy seam with a stated
    reason, so that the next person does not have to guess whether it is shared.
33. As a developer, I want a guard asserting the table is on neither retention
    inventory, so that "permanent" is enforced rather than assumed.
34. As a developer, I want one service module to be the table's only writer, so
    that the write rules live in one place.
35. As a developer, I want the domain glossary to define Reference as the
    pairing, so that the code and the vocabulary agree.

## Implementation decisions

### The Reference row

A new table holds one row per Reference, with a surrogate uuid primary key for
consistency with the rest of the schema. Its columns:

- The source chat id, a non-null bigint. This is the identity of the referencing
  channel and part of the uniqueness key.
- The source handle, non-null text, denormalised so a `t.me` link needs no join.
  Deliberately not part of the key: a renamed channel leaves a stale handle
  beside a correct id, rather than an unresolvable row.
- The source post id, a non-null integer, meaning the Telegram post id.
- The source Post's timestamp, denormalised. Without it a permanent Reference
  whose Post retention deleted cannot be placed in time at all.
- The target handle, non-null and normalised.
- The target chat id, nullable. Filled at write time when the Directory already
  knows it, left null otherwise. Nothing goes back to fill it in later; a read
  resolves the null case by joining the Directory, whose rows are never deleted.
- The target post id, nullable.
- The kind, non-null text, one of `forward`, `mention`, `link`, `reply`.

Uniqueness is `NULLS NOT DISTINCT` over source chat id, source post id, target
handle, kind and target post id. Postgres 18 is the deployed version, so the
clause is available. Plain `UNIQUE` would be decorative here: the target post id
is null for every mention and for every pre-existing forward, and under default
null semantics those rows would never collide, so each re-run would duplicate the
majority of the table. Every write uses `ON CONFLICT DO NOTHING`.

A second index covers the target handle alone. It ships in this pass although no
consumer exists yet, because the reverse lookup is the reason the table exists
and building an index on a multi-million-row table costs more the longer it is
deferred.

The table has no foreign keys and no owner column. No key to the source Post,
because retention already deletes Posts in bulk by channel name and post id
rather than through the surrogate id, so an added key would have forced retention
changes to buy referential integrity the permanence decision rejects anyway.

### Tenancy and retention

The table is classified `CORPUS` in the tenancy seam, by the argument the
Directory sample already makes: the graph exists precisely to record channels
nobody follows, so scoping it by Follow would hide the rows that have the
strongest reason to be there. No owner column, no NOT NULL owner backfill.

The table is never pruned and appears on neither retention inventory. A guard
asserts that, in the shape the quota ledger's guard already takes. The one
privacy fact worth stating plainly: a Reference row reveals that somebody on this
deployment scrapes a given channel, which is the same fact a Directory entry
already discloses.

### Kind vocabulary

The graph recognises four kinds where the existing signal vocabulary recognises
three. A cross-channel reply is folded into `link` by the existing extractor, on
the stated grounds that it is a `t.me` link like any other. The graph keeps it
separate, because a reply is the one kind with an exact target post available
today and because "replied to" is not "linked to".

The existing signal vocabulary and the Discovery aggregation are left untouched,
so no report's counters shift. The graph's extractor is therefore a sibling of
the existing one rather than a caller of it, and a test asserts the two agree on
the set of handles found for the same Post. Without that assertion the two
definitions drift apart silently, which is the failure this whole feature would
be worthless under.

### Where the target post id comes from

Per kind, against what the scrapers store today:

- A reply already carries its target post id on the Post row. Nothing to build.
- A link is recoverable. The existing url-to-channel helper discards the id
  segment on purpose, but the raw href survives verbatim on the Post's links
  blob. A new sibling helper returns both the channel and the id; the existing
  helper is left alone, because it has several callers that want only a handle.
- A forward is not recoverable from stored data. The scraper resolves the handle
  out of the href and never keeps the href, so this feature adds a parsed
  forwarded-from post id column to both the Post and the Directory sample models
  and populates it at scrape time. This only ever helps Posts scraped after the
  change. Every existing forward keeps a null target post forever, and no
  backfill can recover it.
- A mention has no url beneath it and never yields one.

### The write paths

One new service module owns the table and is its only writer, declared as an
aggregate. Three callers reach it and none touches the table directly:

1. The Directory harvest tick gains a second walk, over its own flag. It selects
   a bounded page of Posts, extracts their References, writes them and marks the
   flag, in one transaction, in the shape the existing harvest walk already uses.
2. The probe result path mines Directory samples immediately after the snapshot
   is replaced, in the same transaction, where the entry's chat id is already in
   hand.
3. The backfill script calls the same batch function as the sweep, with a large
   batch size, in a loop until it returns zero.

### Progress is its own flag, not the harvest's

The Post model gains a reference-extraction boolean with a server default and a
partial index over the unextracted rows, mirroring the harvest flag's shape.

Sharing the harvest flag was considered and rejected. The harvest flag is already
exhausted, having completed its first pass, so sharing it would have required
resetting it across the whole corpus, refilling its partial index from empty and
waiting roughly a month at the current scan limit and tick interval. Worse, the
deferral rule below defers a Post by leaving its flag unset, and the harvest walk
orders newest-first, so a single channel with no chat id and more recent Posts
than the scan limit would have stalled the Directory enqueue for the entire grace
period. Two flags cost one column and keep the two subsystems independent.

### The missing chat id rule

A Reference cannot be written without its source chat id, which is not always
available: a sync whose scrape yields no chat id proceeds anyway, and a channel
frozen by a chat-id collision keeps its Posts with the column unset.

Such a Post is deferred rather than skipped. Its flag stays unset so a later tick
retries it once the id lands. Past a grace period it is marked and skipped for
good, so a channel that never yields a chat id does not accumulate work without
bound. The sweep returns a count of deferred and skipped Posts so the gap is
visible.

The grace is measured from the later of the Post's own clock and a stored epoch
written when the feature is deployed. The Post's clock is the time it was
retrieved, falling back to its Telegram timestamp, so a Post published years ago
but scraped today gets its full grace. Without the epoch the grace would expire
instantly for every pre-existing Post, which is exactly the population it exists
to protect. The epoch is one deployment-policy settings row, classified in the
settings registry with a sentence, so an Operator can see why a skip happened.

The grace period in days is a new integer setting with a default of seven, which
obliges a matching entry in the environment example file because a guard asserts
the file ships the code's default for every integer.

Directory samples get no deferral. They carry no per-row flag and the snapshot is
replaced wholesale on every probe, so there is nothing to defer with; an entry
with no chat id is skipped outright and the next probe re-mines the same Posts
anyway, with the conflict clause absorbing the overlap. This is deliberately a
different rule from the one Posts get, and the module says so rather than
implying the two are symmetric.

### A recheck stops clearing the chat id

The Directory currently contains two statements that contradict each other. The
probe-result path argues that the chat id is immutable and a remembered one stays
true however the page changed, and keeps it. The manual recheck path clears it.
Once References key on the chat id, a recheck would blind sample mining for that
entry until the next probe returns. The recheck stops clearing it, and the
reasoning is recorded where the clearing used to happen.

### The first pass runs as a script, not a migration

The migration adds the table, the two columns, the indexes, the uniqueness
constraint and the epoch settings row. It performs no bulk update. The prestart
step runs migrations with the service down, and a multi-million-row update there
stalls a deploy for an unknown number of minutes with nothing reporting progress.

The first full pass over the existing corpus is a maintenance script, run by hand
after the deploy, in bounded committed batches, with a dry-run mode. It shares
the sweep's batch function rather than reimplementing it, so a backfill cannot
drift from steady-state behaviour.

### Nothing reads it yet

No routes, no schemas, no client regeneration, no frontend. A surface designed
against an empty table is a guess, and the shape of the real data is the input
that decision needs.

## Testing decisions

A good test here asserts what an Operator could observe: which rows exist after
an action, what a second run changes, what a parser returns for a given page. It
does not assert which private function was called or in what order. The internal
conflict-handling insert is reached only through the two entry points below and
is not tested directly, because doing so would pin the implementation rather than
the behaviour.

Four seams, of which two are new.

**The pure extractor.** Takes one source, a Post or a Directory sample, plus its
chat id, and returns the References it implies. No session, no fixtures. It
covers the four kinds, the two-links-two-rows rule, the same-channel reply
producing nothing, target post id recovery per kind, and the parity assertion
against the existing reference extractor's handle set. Prior art: the post links
parser tests and the discover candidate tests.

**The batch entry point.** One DB-backed function that the sweep and the script
both call unchanged. It covers dedup across a second run including the null
target post id case, the defer-then-skip boundary on both sides of the grace, the
flag transition, the deferred and skipped counts, and the opportunistic target
chat id fill. Prior art: the directory refresh tests.

**The probe result path, an existing seam.** Sample-derived References are
asserted where the probe's behaviour is already tested, rather than in a new
file, because the behaviour under test is "a probe stores what it saw". It covers
a sample-sourced Reference surviving the snapshot being replaced, and an entry
with no chat id being skipped rather than deferred. Prior art: the directory
samples tests.

**The scraper's HTML parse, an existing seam.** Fixture html in, parsed dict out,
asserting the forwarded-from post id is captured and that a non-Telegram host
masquerading as one is still rejected. Prior art: the post reply parser tests.

Beyond those, the table is picked up for free by existing guards: the service
kind inventory, the tenancy seam classification guard, the test-cleanup
truncation inventory, and the environment example guard. Two assertions are added
to the retention guard, stating the table is on neither inventory.

Every assertion is mutation-tested before being trusted. A guard that has never
been watched to fail has not been shown to work, and this repo has caught false
passes that way before.

## Out of scope

- Any route, schema, generated client change or UI. Nothing reads the table in
  this effort.
- Aggregation or weighting. The graph is per-occurrence rows; a weight is a
  `GROUP BY` at read time and is not precomputed or stored.
- A graph database. The access shape is single-hop lookups at modest scale, and a
  second datastore would sit outside this repo's tenancy, retention and migration
  patterns for no gain.
- Recovering target post ids for forwards already in the corpus. The href was
  never stored; no backfill can invent it.
- Spending Telegram requests to resolve missing chat ids, or any new scrape lane
  for deep-scraping unfollowed channels. Both are separate efforts, to be judged
  after this one is measured.
- A second write path that backfills target chat ids as targets get probed. The
  read-time join answers it, and the Directory rows it joins to are never
  deleted.
- Pruning of any kind, including of References to targets the Directory has
  ruled unfollowable.

## Further notes

The two facts that most changed this design during grilling, recorded because
both look like the opposite is true:

The harvest sweep is not a free ride. Its flag is one-way and its first pass
already finished, so hooking reference extraction into it would have seen only
newly scraped Posts. Every one of the existing Posts is already marked.

Retention never touches the Post's surrogate id. It deletes in bulk by channel
name and post id, which is why declining a foreign key costs nothing here and
adding one would have cost a retention change.

The architecture decision record carries the three decisions that are hard to
reverse and surprising without their argument: permanence with no pruning,
identity on the chat id rather than the handle, and one row per occurrence rather
than a weighted pair.
