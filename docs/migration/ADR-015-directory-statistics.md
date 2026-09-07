# ADR-015: Directory statistics are stored at probe time, not derived on read

**Status:** Accepted (2026-09-08). Extends ADR-014, which created the Directory and its sample
Posts.

## Context

ADR-014 gave every Directory entry a snapshot of the Channel's twenty most recent Posts, replaced
wholesale on each conclusive probe and expiring on its own retention window. The Posts carry
their timestamps, their forward attributions and their view counts.

`.scratch/discover-signals/spec.md` derives statistics from that snapshot so a Candidate row can
answer "follow this Channel or not" without a trip to Telegram: last post age, sample count,
posting rate, median views, forward share and script.

Those six are the subject of this ADR. Two further values on the same row, the media mix and the
media density, are **not**: they derive from the four media counters and the latest Post id,
columns on the entry itself, so they are computed at read from data already selected. The
distinction is the whole decision, so it is worth stating plainly. What follows applies to
statistics derived from **sample Posts**.

The two families also differ in how long they last, and the retention promise below covers only
the first. The counters are overwritten on every write and an `unavailable` verdict is synthesised
with no page, so a Channel Telegram stops serving loses its counters and its latest Post id, and
with them the mix and the density. This matches what the deployment already does with the
subscriber count on that same path. A counter is a snapshot of a page and a stale one is a lie,
which is why the chat id is the single field that survives it. A sample-derived statistic makes a
different kind of claim, about what the Channel *did*, and that stays true after the Channel is
gone.

The obvious place to compute them is the read. The samples are already in Postgres, the transform
is pure, and computing on read means no schema change, no migration, no backfill, and no
possibility of a stored number disagreeing with the rows it was derived from. It is the smaller
change by every measure.

Two facts make it the wrong one.

**The entries that lose their samples are exactly the ones that can never recompute them.**
Samples are replaced wholesale on each probe, and a live entry re-probes on the refresh window,
which is far shorter than the sample retention window, so a live entry's samples never age out.
An entry loses its samples in one of two ways, and both are terminal. An `unavailable` verdict
clears them outright. Any entry that is not refreshable, by verdict or by kind, has its refresh
due date set to null, is never probed again, and has its samples collected by retention.

In both cases the entry stops being visited, so there is nothing to derive from and no future
event that would fill the gap. Deriving on read therefore blanks the statistics on precisely the
Channels whose deadness is the most useful thing a row could say. The Operator would see a full
row for every live Channel and an empty one for every dead Channel, which inverts the signal:
"stopped posting fourteen months ago" is information, and "we know nothing about this" is not.

**The statistics have to be on the list read.** The row shows four of them and sorts on all of
them, so they travel with every Candidate in a report. Deriving on read means aggregating over a
child table per Candidate inside the query that renders the table, which is the shape this
codebase has already paid for twice, at 26 MB and at 56 MB.

## Decision

The six sample-derived statistics are columns on the Directory entry, written at probe time by the
aggregate that already writes the samples, in the same transaction: last post at (timestamptz),
sample count (smallint), posts per week (float), median views (int), forward share (float) and
script (text). All six are nullable, because absent and zero are different claims.

The computation lives in a pure transform that takes **a list of Posts**, not a Directory entry.
The probe path is its only caller today.

The media mix and the media density are **not** stored. They are computed at read from the four
media counters and the latest Post id, columns that already sit on the row. Storing them would
duplicate state that can drift from its own inputs. They live only as long as the page they
describe, and are absent for an entry Telegram no longer serves, exactly as the subscriber count
already is.

An `unavailable` verdict **keeps** the statistics, unlike the samples, which that verdict clears.
An entry that Telegram has stopped serving stops being refreshed and can therefore never recompute
them, and it is the row where the last known picture is worth the most. Only the recheck path,
which resets an entry to "no answer" and clears every other metadata field, clears them too.

A migration backfills every entry that already has samples, because that data is already in
Postgres and the transform is pure.

An entry that stops being probed keeps the last statistics it was given. They are labelled by
their own last-post timestamp, so a stale number is self-describing rather than misleading.

## Why not a companion table

The list-vs-detail rule in this repo says to split a field into a companion table rather than a
sibling column. That rule exists to keep large detoastable values off list reads. These are four
small numbers, a short string and a timestamp that the list read specifically needs, so a
companion table would put a join on the one query that has to stay cheap, in service of a rule
aimed at the opposite problem.

## Why the transform takes Posts and not an entry

For a Channel somebody follows, the corpus holds every Post, which is a far better input than
twenty samples. That computation belongs to the Channels tab and is out of scope here. Taking a
list of Posts means pointing the same transform at the corpus later is a new caller rather than a
second implementation of the same formulas, which is the failure mode this codebase already
documents under twin modules: a fix applied to one of two copies is half a fix.

## Consequences

A followed Channel's statistics go stale. The metadata refresh that runs for free on every sync
fetches no samples, so it updates counters and leaves the statistics alone. Accepted: Discover is
mostly about Channels nobody follows, and the followed case has a better answer waiting in the
corpus.

The stored numbers can disagree with the samples an entry currently holds, between a probe that
replaced the samples and any future change that forgets to recompute. The write path is a single
aggregate function and the test suite asserts all six move together on every verdict transition,
which is the mitigation.

A future change to a formula requires a backfill to apply retroactively, where a read-time
derivation would have applied itself. This is the real cost of the decision and it is accepted;
the formulas are simple and the backfill is the one already written for this ADR.

Adding a seventh sample-derived statistic is a migration rather than a code change.

## What this does not decide

Whether the Channels tab surfaces these statistics, and whether it computes them from the corpus
instead of from samples. Whether the Directory ever gets a browsing surface independent of a
Discovery report. Whether any statistic is ever used to rank or recommend a Channel rather than
to let an Operator sort.
