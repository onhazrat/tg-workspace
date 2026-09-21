# CRG-01: A corpus Post's References are stored

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## What to build

The sweep runs and the graph fills from Posts the deployment already holds. After
this ticket an Operator can point at rows: each one says that a given Post named
a given Channel, in one of four ways, at a given time.

This is the tracer bullet. It cuts through the schema, the tenancy seam, a new
service, the scheduler tick and the tests. Two prefactors are folded in because
everything downstream needs them.

Read `.scratch/channel-reference-graph/spec.md` and
[ADR-019](../../../docs/migration/ADR-019-channel-reference-graph.md) first. The
decisions below are settled; the argument for each lives there.

### The folded-in prefactors

**A url helper that returns the post id.** The existing url-to-channel helper
returns the first path segment only and has several callers that want exactly
that, so add a sibling rather than changing it. The new one returns both the
channel and the post id, shares the existing host validation so a url like
`https://evil.example.com/t.me/foo/123` is still rejected, and refuses a reserved
first segment and its id together rather than separately. CRG-03 needs it too.

**A Directory recheck stops clearing the remembered chat id.** The probe-result
path argues the chat id is immutable and keeps it; the manual recheck path clears
it. Once References key on that value, a recheck blinds the graph for that entry
until the next probe. Resolve it in favour of the probe path and record why where
the clearing used to happen. CRG-02 depends on this being true.

### The Reference row

One row per Post naming one Channel in one way. Surrogate uuid primary key.
Non-null source chat id as a bigint, non-null source handle, non-null source post
id, non-null denormalised source timestamp, non-null normalised target handle,
nullable target chat id, nullable target post id, non-null kind as plain text.

Uniqueness is `NULLS NOT DISTINCT` over source chat id, source post id, target
handle, kind and target post id. Autogenerate cannot express that, so write it by
hand and declare it in the model anyway, for the reason the Post model already
gives: autogenerate reads metadata rather than intent, and an index it cannot see
is one it emits a drop for next revision. A second plain index covers the target
handle alone; it ships now although nothing reads it yet, because adding it later
costs more on a table that only grows.

No foreign keys, no owner column.

### Classification

`CORPUS` in the tenancy seam, with the Directory sample's argument in its own
words. On neither retention inventory, asserted, in the shape the quota ledger's
guard takes.

### The service

One new module, declared as an aggregate, sole writer of the table. It holds the
pure extractor, the conflict-handling insert and the batch function the sweep
calls. The insert is internal and is not a tested seam.

### The kind vocabulary trap

The existing reference extractor folds a cross-channel reply into `link`. The
graph does not, so the new extractor is a sibling of that function rather than a
caller, and the two can drift apart with nothing noticing. Assert they produce
the same set of target handles for the same Post. The kinds differ by design; the
handles must not.

### The missing chat id rule

The source chat id is not always known. A Post whose channel lacks one is
deferred, not skipped: its flag stays unset so a later tick retries it. Past a
grace period it is marked and skipped for good, and the sweep returns counts of
both so the gap is visible.

The grace compares against the later of the Post's own clock, which is its
retrieval time falling back to its Telegram timestamp, and a stored epoch written
by this ticket's migration. Both halves matter: the Post clock stops a Post
published years ago but scraped today from being skipped on sight, the epoch
stops the entire pre-existing corpus from expiring the instant this deploys.

The grace in days is a new integer setting defaulting to seven, which obliges a
matching environment-example entry. The epoch is one deployment-policy settings
row, classified in the settings registry with a sentence.

### The flag and the sweep

The Post model gains a reference-extraction boolean with a server default and a
partial index over the rows still to do, mirroring the harvest flag's shape.

Do not reuse the harvest flag. It is one-way and already exhausted, so sharing it
would mean resetting the whole corpus and refilling a partial index from empty,
and the deferral rule above would stall the Directory enqueue for the whole grace
period when one chat-id-less channel has a large recent backlog.

The Directory harvest tick gains a second walk calling the batch function. Same
job module, same tick, no new scheduler entry and no new interval setting. Follow
the existing walk's shape, including expunging the page after marking it, which
is not cosmetic there: without it the page bounds one query and nothing bounds
the tick. Never hold the session open across awaited work.

### The glossary

The domain glossary's Reference entry now means the pairing rather than the Post.
It has already been rewritten; check it still matches what you built.

## Acceptance criteria

- [ ] The migration applies and reverses cleanly, and performs no bulk update
- [ ] Running the sweep against seeded Posts writes the expected References, and
      running it again writes none, the null target post id case included
- [ ] A Post naming two Channels yields two References; a Post that forwards from
      and mentions the same Channel yields two; a same-channel reply yields none
- [ ] A cross-channel reply is stored as its own kind while the existing signal
      vocabulary and every Discovery counter are unchanged
- [ ] The new extractor and the existing one agree on the set of target handles
      for the same Post
- [ ] A Post whose channel has no chat id is deferred inside the grace and
      skipped past it, and both are counted in what the sweep returns
- [ ] A pre-existing Post gets a full grace window measured from the stored epoch
      rather than expiring immediately
- [ ] The Directory harvest's own behaviour is unchanged and its tests pass
      untouched, including with a chat-id-less channel holding a large recent
      backlog
- [ ] The new url helper rejects a spoofed host and a reserved first segment, and
      the existing helper's tests are untouched
- [ ] A Directory recheck leaves the remembered chat id in place
- [ ] The tenancy seam, service kind, cleanup inventory and environment example
      guards all pass with no exemption added, and the table is asserted to be on
      neither retention inventory
- [ ] Every new assertion has been mutation-tested: broken, watched to fail,
      restored

## Notes

Forwards get a null target post id until CRG-03 lands the column. Nothing here
changes when it does, beyond the extractor reading one more field.
