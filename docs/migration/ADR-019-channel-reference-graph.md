# ADR-019: The channel reference graph is per-occurrence and permanent

**Status:** Accepted (2026-09-21). Builds on [ADR-014](./ADR-014-channel-directory.md), which gave
the deployment a corpus-wide map of what exists on Telegram, and on
[ADR-015](./ADR-015-directory-statistics.md), whose sample snapshots this reads a second time.

## Context

Every Post the deployment stores may name other channels: a forward, a plain-text mention, a
masked `t.me` href, a reply that crosses channels. `discover.post_references` has extracted those
since the Discovery feature shipped, and two callers consume it.

A Discovery report aggregates them into per-candidate counters and keeps, per candidate, the
single newest Post that named it. The harvest sweep reads the handles, enqueues the ones the
Directory does not already hold, and discards the rest.

Both throw away the same thing: which Post named which handle. So the deployment can answer "how
many Posts in this Scope named @foo" and cannot answer "which Posts", "in which direction",
"when", or anything at all about a channel outside somebody's current Scope.

There is also a corpus we have already paid for and never read. A Discovery probe of an
unfollowed channel stores a snapshot of that channel's recent Posts as Directory samples. Those
Posts carry references exactly as corpus Posts do. Nothing has ever mined them.

Three decisions here are hard to reverse once rows exist, and each had a real alternative.

## Decision 1: one row per occurrence, not a weighted pair

A Reference is one Post naming one Channel, once, in one way. A Post linking to two channels
produces two rows. A Post that forwards from @foo and separately mentions @foo produces two rows,
because the kinds differ.

The obvious alternative is an aggregated edge, `(source, target, weight)`, updated in place. It is
smaller by roughly the average references-per-pair and it answers "how connected are these two"
directly.

It also answers nothing else. A weight cannot be filtered by date, narrowed to a kind after the
fact, or traced back to the Post that justified it, and the evidence is the part an Operator
actually wants: a count nobody can audit is a number to distrust. Per-occurrence rows derive the
weight with a `GROUP BY` at read time, which is the cheap direction. The reverse, reconstructing
occurrences from a weight, is impossible.

The cost is row count. The corpus is roughly 4.7 million Posts and the table grows with it,
without ever shrinking. We accept that, and decision 2 is why it is affordable.

## Decision 2: identity is the chat id, not the handle

The source end of a Reference is keyed by `telegram_chat_id`, a non-null bigint, not by the
handle. The handle travels on the row too, denormalised, so a `t.me` link needs no join, but it is
not part of the uniqueness key.

Handles are reusable. A channel that renames frees its old handle for somebody else, and a graph
keyed by handle silently merges two unrelated channels into one node the moment that happens.
`DirectoryEntry` already states the rule this follows: the chat id is "the only identity that
survives a handle rename, so it is the one stable thing recorded about an entry."

The price is real and was argued over. A source chat id is not always known. A sync whose scrape
yields no chat id proceeds anyway, and a channel frozen by a chat-id collision keeps its Posts
with the column unset. Making the column non-null means those Posts produce no Reference at all.

The alternative, keying on the handle and treating the chat id as decoration, was rejected because
it makes the graph quietly wrong rather than visibly incomplete. Incomplete is recoverable; a
merged node is not.

The gap is handled rather than ignored: such a Post is *deferred*, retried on later ticks, and
only skipped after a grace period measured from the later of the Post's own clock and a stored
epoch written at deploy. Without the epoch the grace would expire instantly for every Post already
in the corpus, which is the population it exists to protect. The sweep reports how many Posts it
deferred and skipped, because a silent gap in a graph is worse than a visible one.

The target end is keyed by handle and carries a nullable chat id filled opportunistically, because
a target is usually a channel nobody has probed yet and its chat id is by construction unknowable
until somebody fetches its page. A read resolves the null case by joining the Directory, whose
rows are never deleted.

## Decision 3: the graph is permanent, the corpus is not

References are never pruned. The table appears on neither retention inventory, and a guard asserts
that, in the shape `tg_quota_usage` already established.

This deliberately breaks the symmetry every other derived table here keeps. Post embeddings,
translations and sync state all die with their Post. A Reference outlives it.

The reason is what a Reference is. An embedding is a representation of a body we no longer hold,
so it is worthless without it. A Reference is a fact about a relationship, and the `t.me` permalink
it carries still resolves against Telegram years after our copy is gone. Its source timestamp is
denormalised onto the row for the same reason, so a Reference whose Post has been deleted can still
be placed in time without joining a row that no longer exists.

The consequence to accept: `postRetentionDays` no longer bounds everything derived from Posts. An
Operator who shortens the retention window to reclaim disk keeps paying for the graph. That is the
trade, and it is the right way round, because the graph is the small table and the accumulated
knowledge, and the corpus is the large one and the replaceable part.

There is no foreign key to the Post, which costs nothing: retention already deletes Posts in bulk
by `(channel_name, post_id)` rather than through the surrogate id, so a key would have forced a
retention change to buy integrity that permanence rejects anyway.

## Consequences

The table is `CORPUS` in the tenancy seam, by `DirectorySample`'s argument: the graph exists
precisely to record channels nobody follows, so scoping it by Follow would hide the rows with the
strongest reason to be there. It carries no owner column. A Reference row discloses that somebody
on this deployment scrapes a given channel, which is the fact a Directory entry already discloses.

The graph recognises four kinds where `SignalKind` recognises three: a cross-channel reply is
`reply` here and `link` there. The existing vocabulary and every Discovery counter are left
untouched, so the graph's extractor is a *sibling* of `post_references` rather than a caller. A
test asserts the two produce the same set of handles for the same Post. Without it the two
definitions of "a reference" drift apart with nothing to notice, which would make the graph
worthless in the least visible way available.

Reference extraction gets its own progress flag rather than sharing `Post.harvested`. Sharing it
would have meant resetting an exhausted flag across the whole corpus, refilling its partial index
from empty, and waiting about a month at the current scan limit. Worse, deferral works by leaving
a flag unset, and the harvest walk is newest-first, so one chat-id-less channel with a large recent
backlog would have stalled the Directory enqueue for the entire grace period.

Nothing reads the table in the effort that creates it. No routes, no client, no UI. A surface
designed against an empty table is a guess, and the shape of the real data is the input that
decision needs.

## Alternatives considered

**A graph database.** Raised directly. Rejected: the access shape is single-hop lookups at modest
scale, Postgres answers it with two indexes, and a second datastore would sit outside this repo's
tenancy, retention, migration and test-cleanup patterns while buying nothing this feature asks for.

**Storing the target's chat id properly, via a second write path that fills it in as targets get
probed.** Rejected: it would make the table's sole-writer rule a fiction and needs its own sweep,
to produce an answer the read-time join already gives against rows that are never deleted.

**Extracting at ingest rather than as a sweep.** Rejected for the reason the harvest sweep already
records: it puts the work inside a walk an Account is waiting on, gives the deployment no throttle
at all, and by construction never reaches the Posts already stored.
