# Spec: Discover Signals

**Status:** ready-for-agent

Implements the surface `.scratch/channel-directory/spec.md` deferred: *"A browsing or search
surface over the Directory. This work builds the map; the UI that reads it is a separate
feature."* That work built the map. This one reads it.

## Problem Statement

The Directory now holds, for every handle anyone has seen referenced, a subscriber count, four
media counters, a numeric chat id, a followability verdict, refresh state, and a snapshot of the
Channel's twenty most recent Posts including their view and reaction counts. All of it is paid
for on every probe: the request, the proxy Lane, the latency, the quota row.

Discover renders four fields of it. A Candidate row shows a status badge, a kind, a display name
and a subscriber count. The panel behind it shows the Reference that surfaced the Candidate and
nothing about the Channel itself.

So deciding whether to follow a Candidate still means opening Telegram. The Operator cannot tell
from the report whether a Channel is alive, how often it posts, whether anybody reads it, what
language it publishes in, whether it writes its own material or reposts other people's, or
whether it is mostly photos, mostly video or mostly text. Every one of those answers is already
in Postgres, scraped, stored and never read. The sample Posts in particular have no route at
all: the function that reads them still carries the comment "No production caller yet."

The consequence compounds. A report can surface dozens of Candidates and the only ordering
signal is a subscriber string, so triage means opening every panel in turn, and each panel sends
the Operator to Telegram anyway.

## Solution

Turn what the probe already stores into the answer to one question: **follow this Channel or
not?**

A pure transform derives a small set of statistics from a Directory entry's sample Posts and its
counters. Those statistics are stored on the entry at probe time, so they survive the sample
retention window that eventually prunes the Posts they were derived from. The Candidate table
shows the four that matter for triage, so a report can be scanned without opening anything. The
panel repeats those, adds the rest, and puts the sample Post bodies themselves behind a
disclosure, so "what does this Channel actually publish" is answered in the app rather than on
telegram.org.

Nothing here adds a Telegram request. Every number comes from a page the deployment already
fetched.

One rename comes first. The frontend already calls the Post that surfaced a Candidate a
`samplePost`, while `CONTEXT.md` spends the word "sample" on the Directory's snapshot of a
Channel's *own* Posts. The two point in opposite directions and this feature puts them on the
same screen, so the referencing Post becomes a **Reference** before anything else lands.

## User Stories

1. As an Operator, I want each Candidate row to show when the Channel last posted, so that I can
   see a dead Channel without opening it.
2. As an Operator, I want to sort Candidates by last post age, so that I can put every dormant
   Channel at the bottom of the report in one click.
3. As an Operator, I want each Candidate row to show how often the Channel posts, so that I can
   tell a daily firehose from a weekly digest before I follow it.
4. As an Operator, I want each Candidate row to show the median views on its recent Posts, so
   that I can tell whether anybody actually reads it.
5. As an Operator, I want the median rather than the mean, so that one viral Post does not
   relabel a Channel nobody reads.
6. As an Operator, I want a Channel's media mix shown as a shape rather than four numbers, so
   that I can see at a glance that it is a photo dump and not a text Channel.
7. As an Operator, I want to sort Candidates by any of the statistics on the row, so that I can
   triage a large report along whichever axis I care about today.
8. As an Operator, I want a statistic to be blank rather than wrong when there are too few sample
   Posts to support it, so that a three-Post Channel cannot outrank a real one on a fluke.
9. As an Operator, I want the raw Post count shown even when the derived rates are suppressed, so
   that I can see the data exists and know why the rates are missing.
10. As an Operator, I want to open a Candidate and read the text of its recent Posts, so that I
    can judge its subject matter without leaving the app.
11. As an Operator, I want the sample Posts behind a disclosure rather than open by default, so
    that opening a panel does not put a wall of text in front of the statistics I came for.
12. As an Operator, I want each sample Post to carry its date, its view count and a link to
    Telegram, so that I can tell whether the median is flattered by one outlier and can open the
    original when I want to.
13. As an Operator, I want the panel to repeat the statistics from the row, so that I do not have
    to close it to recheck a number I was just reading.
14. As an Operator, I want to know what share of a Channel's Posts are forwarded from elsewhere,
    so that I can tell an original source from an aggregator reposting the Channels I already
    follow.
15. As an Operator, I want to know which alphabet a Channel publishes in, so that I can rule out
    half a mixed-language report at a glance.
16. As an Operator, I want to see how media-heavy a Channel is relative to its Post count, so
    that I can tell a text Channel from one that mostly posts images.
17. As an Operator, I want a Channel that stopped being probed to keep what its sample Posts said
    about it, so that a long-dead Channel still reads as long dead rather than as unknown.
17a. As an Operator, I want a Channel Telegram no longer serves to stop claiming a subscriber
    count and a media mix, so that I am not shown a page's numbers for a page that is gone.
18. As an Operator, I want statistics computed for the entries that were probed before this
    feature shipped, so that the report is not empty for the first week.
19. As an Operator, I want a Candidate that has never been probed to say so plainly, so that I do
    not read a missing statistic as a bad one.
20. As an Operator, I want to request a recheck on a Candidate that has no Directory entry yet,
    so that I can pull a specific handle forward without waiting for the sweep to reach it.
21. As an Operator, I want to see how many probe Requests the deployment has spent today and this
    week, so that I can tell whether the sweep is running away from me.
22. As an Operator, I want to see whether the harvest is enabled and currently running, so that I
    can tell an idle queue from a stopped one.
23. As a User who is not an Operator, I want to never see scraping errors, attempt counts or what
    the deployment has spent, so that the Discover tab reads as a product rather than a job
    console.
23a. As a User without permission to manage jobs, I want not to be shown a pause button that
    answers 403, so that the controls I can see are the controls I can use.
24. As a User, I want the statistics on a Candidate to be about the Channel and not about the
    deployment's attempts to reach it, so that the row means something to me.
25. As a Developer, I want the statistics computed by one pure function, so that I can test the
    arithmetic without a database.
26. As a Developer, I want that function to take a list of Posts rather than a Directory entry,
    so that the Channels tab can later point it at the corpus without a second implementation.
27. As a Developer, I want the Directory's detail read mounted as its own resource family rather
    than under Discover, so that the Channels tab can use it without going through report
    machinery.
28. As a Developer, I want the referencing Post called a Reference everywhere, so that the word
    "sample" means exactly one thing on a screen that now shows both.
29. As a Developer, I want the rename to land as its own change, so that a mechanical wire rename
    is reviewable on its own rather than buried in a feature that also adds six columns.
30. As a Developer, I want the sample Post bodies kept off the report response, so that a report
    with forty Candidates does not ship eight hundred Post bodies to the browser.
31. As an Operator, I want a report to keep loading as fast as it does today, so that richer rows
    do not cost me the thing that already works.

## Implementation Decisions

### The Reference rename lands first, alone

The Post in a followed Channel that surfaced a Candidate becomes a **Reference**. The rename goes
all the way through: the response field, the hand-written client type, the component props, the
UI copy, and the glossary. Leaving the wire saying `samplePost` while the UI says Reference
relocates the confusion to whoever reads the schema next rather than removing it.

It ships as the first change with nothing else in it. The exact-key-set projection tests catch
every miss, which is exactly the property that makes a rename safe and the property that gets
lost when it is bundled with a change that also edits those key sets for other reasons.

**It is not only a rename, because reports are saved.** A Discovery report is an Artifact whose
Candidates are persisted as JSON at generate time; the read path spreads those stored dicts and
overlays only follow state, dismissal state and the probe verdict. The response field is required
with no default, so renaming the model without touching stored data makes every report saved
before the change fail validation on read.

The fix is a tolerant read at the seam that already normalises stored candidates, not a migration
over the JSON. A migration repairs the rows in this database and does nothing for an old export
imported next month, which the import path makes a real case. A regression test opens a fixture
holding the pre-rename key.

### Six stored values from a pure transform, two more derived at read

The transform takes a list of sample Posts and returns six values, each stored in its own nullable
column on the entry:

- **last post at** — the timestamp of the newest sample Post.
- **sample count** — how many Posts the statistics were computed from, so a suppressed rate can
  explain itself.
- **posts per week** — the intervals between the sample Posts over the span they cover, expressed
  weekly. See below; it is not the Post count divided by the span.
- **median views** — median, not mean, of the sample Posts' view counts.
- **forward share** — the fraction of sample Posts carrying a forward attribution.
- **script** — which alphabet the sample *captions* are predominantly written in, by
  character-range heuristic. Not a language, and no language library.

Two further values are computed **at read** rather than stored, because their inputs are already
columns on the same row:

- **media mix** — the four counters as shares *of each other*, summing to 100%.
- **media density** — the four counters summed and divided by the latest Post id.

Storing those two would duplicate state that can drift from its own inputs, and buys nothing:
the counters are already selected by any query that reads the entry, so the derivation costs no
join.

**They do not outlive the page, and the promise is written accordingly.** The counters are
overwritten on every write and an `unavailable` verdict is synthesised with no page at all, so a
Channel Telegram stops serving loses its counters and has its latest Post id reset to zero. Mix and
density vanish for exactly the entries whose sample-derived statistics persist.

That asymmetry is deliberate and the codebase already commits to it: the **subscriber count is
cleared on the same path today**, so a dead entry already loses it. A counter is a snapshot of a
page and a stale one is a lie, which is why the chat id is the one field that survives. A
sample-derived statistic is a different kind of claim, describing what the Channel *did*, which
stays true after it goes away; "this Channel has 40,000 subscribers" does not.

So a dead Channel's row keeps last post age, cadence, median views, forward share and script, and
loses subscribers, mix and density. ADR-015 covers only the first group.

Subscribers already exists on the entry and is not recomputed.

### The median needs measured views, and it rounds

A view count is optional on a sample Post, so twenty samples can carry one measured view between
them. Gating the median on the *sample* count would let that single observation become the median
and rank the Channel on it, which is the failure the threshold exists to prevent. The median needs
five samples that carry a view count, counted separately from the sample count gating the other
rates.

It is rounded to an integer, because an even set has a fractional median that the column cannot
hold. Rounding rather than widening the type: the counts are parsed from Telegram's abbreviated
display strings, where `9.74K` becomes 9,740, so half a view sits below the precision of the input.

### Posts per week counts intervals, not Posts

N sample Posts spanning oldest to newest give **N-1** intervals, so the rate is `(N - 1) / span`.
Dividing the Post count by the span inflates every Channel in the report: five Posts one week
apart span four weeks and describe a weekly Channel, but `5 / 4` reports 1.25 per week, and the
error grows as the sample shrinks.

A **zero span** is reachable even above the sample threshold, because a Channel can post an album
as several messages within the same second. It yields no rate rather than a division by zero.

### Script reads captions, not placeholder text

A media Post with no caption is stored with synthesised stand-in text: `[photo]`, `[video]`,
`[photo album]`, `[voice]`. Those are ASCII. A character-range heuristic run over them would label
a caption-less Persian or Russian photo Channel as Latin, and caption-less Channels are exactly
the image-heavy ones this statistic would otherwise describe well.

So the transform excludes the placeholders and reads captions only. A Channel whose every sample
is a placeholder has **no** script rather than a wrong one.

### Media mix is a share of the counters, and density is a rate

The obvious construction is each counter over the total Post count, presented as a percentage.
It does not survive contact with the data. The counters come from Telegram's channel info bar
and count **media items, not Posts**: an album of five photos adds five, and a Post carrying both
a photo and a link counts in both. The denominator is no better, because the latest Post id
over-counts published Posts, since deleted and service messages consume ids. A ratio inflated on
both sides is not a percentage and presenting it as one would be lying with a number.

So it splits in two. The **mix** needs no denominator at all and therefore works on the seeded
entries whose latest Post id is zero. The **density** keeps the one insight the mix loses, that a
Channel is media-heavy or text-heavy, and it is labelled as a rate, so a value above 1 reads
correctly rather than as a broken percentage.

### The sample-derived statistics are stored, not derived on read

Six columns on the Directory entry, written at probe time by the aggregate that already writes
the samples. Not a companion table: the list-vs-detail rule exists to keep large detoastable
fields out of list reads, and these are four small numbers, a short string and a timestamp that
the list read specifically needs. A companion table would add a join to the one query that has to
stay cheap.

Deriving on read from the samples would be less code and is wrong. An entry loses its samples in
one of two ways, and both are terminal: an `unavailable` verdict clears them outright, and an
entry that is not refreshable by verdict or by kind gets a null refresh date, is never probed
again, and has its samples collected by retention. Either way the entry stops being visited, so
there is nothing to derive from and no future event that fills the gap. A read-time derivation
therefore blanks the statistics on exactly the Channels whose deadness is the most useful thing
the row could say. A stored value keeps reading "last posted fourteen months ago" after its
evidence is collected. This is the spec's one ADR.

### An unavailable verdict keeps the statistics

This is the one place the statistics and the samples part company, and it follows directly from
the argument above. The existing code clears an entry's samples when Telegram stops serving the
Channel; copying that for the statistics would delete the last known picture of exactly the row
that can never rebuild it, since an unavailable entry is never refreshed again.

The recheck path is the exception. It resets an entry to `unknown`, meaning the deployment holds
no answer rather than a negative one, and already clears every other metadata field. The
statistics go with them, because a row claiming no answer must not still show numbers.

### The probe path is the only writer, for now

The statistics can only be computed where sample Posts exist, which is the probe path. The
metadata refresh that runs for free on every sync of a followed Channel fetches no samples, so it
updates an entry's counters and leaves its statistics alone.

That means a followed Channel's statistics go stale, which is accepted. Discover is mostly about
Channels nobody follows, and for followed Channels the corpus holds the real Posts, which would
make a far better input than twenty samples. That is the Channels tab's problem, and the reason
the transform takes a list of Posts rather than a Directory entry: pointing it at the corpus
later is a new caller, not a second implementation.

### Too few samples suppresses the rates

One threshold constant, five. Below it the rate statistics are absent and the raw Post count
still shows. A median over three Posts is a number pretending to be a measurement, and without
the threshold a three-Post Channel can outrank a real one in a sort. Not a confidence model, not
an error bar, one constant in the transform.

### Posts per week is a recent rate, and says so

The rate is computed over the span the samples actually cover, not over a fixed trailing window
and not over the Channel's lifetime. A fixed window reads zero for anything dormant, which
duplicates what last post age already says. A lifetime average from the latest Post id hides
every change in behaviour the Channel ever had.

The span-based rate means "when this Channel is active, it posts this often", which paired with
last post age is honest in both directions: `5/week, last post 14 months ago` describes a Channel
that was busy and then died, and no single blended number says that as well. The UI labels it as
a recent rate so it is not read as current activity on its own.

### Seeded entries keep a blank density

The Directory seed stamped every already-synced Channel with a latest Post id of zero and no
samples, so density is undefined for them. They are left blank. Those entries re-probe on the
normal refresh window and fix themselves, and a backfill migration across the corpus to populate
a decorative statistic is work that expires on its own.

### Existing samples are backfilled

Unlike the seeded latest Post id, the sample Posts written since the Directory shipped are
already in Postgres, and the transform is pure. The migration computes statistics for every entry
that has samples. Without it the feature ships looking empty until the refresh window comes
around.

### The row carries four statistics and a shape

Last post age, subscribers, posts per week and median views as numbers, plus the media mix as a
small stacked bar. That is the triage set: alive, big, busy, read. The mix earns a column because
it reads better as a shape than as four percentages, and costs no reading effort.

The rest — forward share, script, density, and the sample Post bodies — are panel-only. Ten
numbers on a table row is not a scannable row, and a statistic that requires opening a sheet does
not help anyone scan a report.

### The panel repeats the row

The panel is a sheet that covers the row it was opened from, so omitting the row's statistics
would mean closing it to recheck a number. Duplication in a detail view is context, not
redundancy.

### The sample Posts come from their own route, on their own resource family

`GET` by handle under a **directory** resource family, not under discover. The Directory is
corpus-wide and outlives any report, so mounting its read as report machinery misfiles it, and
the Channels tab will want this exact read without a report in sight. It is a new module in the
`/data` package rather than an addition to the discover module.

The route name is fixed at specification time because the operation id derives from the handler
function name, so renaming it later moves a symbol in the generated client.

The response is a closed model with required fields, so it belongs on the **generated** client.
Discover's existing calls live on the hand-written client because their models are open or
all-optional, which is a property of those models and not a property of Discover. Putting this
call beside its neighbours for the sake of tidiness is how the two-client split rots; the conform
guard checks both directions and will say so.

Sample bodies never ride the report response. Forty Candidates times twenty Post bodies is the
26 MB and 56 MB regressions a third time.

### Sorting stays in the browser

The new statistics become sort keys in the existing client-side sort. The report is already
fully loaded to render the table, and its Candidate count is bounded by what a scan surfaced
rather than by the size of the Directory. Server-side sorting would mean a query parameter on a
saved, unpaginated Artifact. Revisit when a real report is large enough to stutter.

Null sorts last, on every key, for the reason the existing subscriber sort already documents:
never probed, probed inconclusively and probed off a page with no counter are indistinguishable
for ranking, and they all belong at the end.

### A Candidate with no entry says so and can be rechecked

There is no probe-on-demand. Opening a panel triggers no Telegram request; the queue decides
ordering and the harvest is already saturating it. An entry with no statistics shows a plain
"not probed yet" and offers the recheck action that already exists, extended to reach rows that
have no Directory entry at all.

### Probe machinery is Operator-only and stays on the probe bar

Requests today, requests this week, harvest enabled and harvest running are surfaced on the
existing probe bar. The queue route already returns them and the hand-written client type simply
omits them, so nothing renders them today. The deployment is spending a rate-limited Request
budget with no visible meter, and that is the one piece of probe machinery worth a pixel.

**Widening the type is the easy half.** The bar returns null unless something is queued, running
or retrying, and the poll predicate is false unless the queue is enabled and draining. Both are
right for a bar reporting work in flight and both are wrong for a spend meter, because a budget
total is most worth reading when nothing is running: the question is "what did the sweep cost",
not "is it moving". So the ticket changes when the bar renders and when its data refreshes, and
the documented reasons those conditions exist have to survive the change rather than be deleted.
The idle refresh is slow; a daily total does not need a fifteen-second poll.

**A permanent bar needs a permission the transient one did not.** The queue route authenticates
its caller and asks nothing else, so any signed-in account can read deployment-wide counts today.
That is tolerable while the bar only appears during a drain, because it reports progress on work
the reader is plausibly waiting for. A permanent spend total is a fact about the deployment's
budget and no business of an ordinary account, so the figures and the pause control render only
for an account that may manage jobs. Everyone else keeps today's bar exactly.

That gate also closes a bug older than this spec: the pause control is rendered for every account
while the toggle it drives is permission-gated server-side, so an ordinary account is shown a
button that answers 403. The bar's usual absence is the only reason nobody has hit it.

Attempts, last error and retry state stay off every user-facing surface. A Candidate row is about
a Channel; it is not about the deployment's attempts to reach one.

### Tenancy is settled, not a question

Directory entries and their samples are corpus-scoped and carry no owner. The new route reads
through the greppable unscoped escape hatch with a typed reason, exactly as the existing probe
routes do, and takes its place in the account-isolation inventory as corpus with that reason.

## Testing Decisions

A good test here asserts what a caller can observe: what an entry holds after a probe, what the
transform returns for a given set of Posts, what key set a response carries, and how a list
orders. It never asserts how a statistic was stored or in what order the transform computed it.

### Seams

Four, one of them new.

**The probe write path** is the seam for everything about storage. Prior art:
`tests/services/test_channel_directory.py`, `tests/services/test_directory_samples.py`.

**The statistics transform** is the one new seam, and it is deliberately lower than the write
path. Testing six statistics through the write path means hand-building a full probe payload for
every arithmetic edge case; the transform is pure, so its tests are a list of Posts and an
expected number. Prior art for a pure transform with its own module: the proxy pacing classifier
and the queue lane policy.

**The API projection tests** are the seam for wire shape. Prior art:
`tests/api/test_discover_projection.py`. The new detail route gets its own module beside the
existing directory tests rather than inside a discover-named one, because the route is not
mounted under discover.

**The frontend candidate library** is the seam for ordering and filtering. Direct prior art:
`discover-subscriber-sort.test.ts`.

The job glue, the panel component, the disclosure and the mix bar are reached through those four
or are wiring not worth its own test.

### What to cover

Through the transform: median is the median and not the mean, and one outlier does not move it;
**five Posts one week apart give one per week and not 1.25**, which is the interval-versus-count
error and the one every naive implementation makes; **a set whose Posts share a timestamp yields
no rate rather than a division by zero**; a set below the threshold yields no rates but still
yields a count; **a set of nothing but `[photo]` placeholders yields no script rather than
Latin**, which is the caption-versus-placeholder error; forward share counts attributions and not
forwards of forwards; the script heuristic separates the alphabets the corpus actually contains;
an empty set returns absent statistics rather than zeroes, because zero Posts per week and no
measurement are different claims.

Through the read-time derivation: the mix sums to 100% and tolerates a missing counter; density
is absent when the latest Post id is zero; neither reads a stored column, so neither can drift;
**an entry marked unavailable has no mix and no density while keeping all six sample-derived
statistics**, which is the seam between the two families and the assertion that keeps the
retention promise honest.

On the median specifically: twenty samples carrying one measured view yield **no** median, so the
threshold cannot be bypassed by a mostly-unmeasured sample set; an even set of measured views
rounds rather than failing to store.

Through the probe write path: a conclusive probe stores all six; the next conclusive probe
replaces them; an unavailable verdict **keeps** them while clearing the samples, which is the one
divergence and therefore the one most worth a test; a recheck clears them along with every other
metadata field; an inconclusive fetch touches nothing; the metadata refresh on a followed
Channel's sync updates counters and leaves statistics alone; the backfill migration computes
statistics for an entry that already had samples and leaves an entry without samples blank.

Through the API projection: the report Candidate carries exactly the expected key set including
the new statistics; the stateless Candidate response still carries no probe field at all, so the
shared model has not quietly acquired an optional one; the detail route returns the entry's
statistics and its sample Posts with dates and view counts; an unknown handle answers 404; the
route reads corpus-wide and is recorded as such in the isolation inventory.

Through the frontend library: each new sort key orders correctly; null sorts last on every key;
the existing subscriber sort still passes unchanged.

Existing guards that must stay green or be extended: the exact-key-set projection tests (four of
them, all of which this feature legitimately changes, and each change is the review); the service
kind inventory, which the new transform module must declare; the route inventory, for the new
route and for the rename; the account isolation inventory, for the new operation; the tenancy
classification guard, which already covers both tables and must keep doing so; the two-client
conform guard, in both directions.

Mutation-test every new guard before trusting it. A green suite proves nothing until it has been
watched go red, which caught a false pass six times in the simplification programme.

## Out of Scope

- A browsing or search surface over the Directory independent of a report. Still deferred, now
  one step closer: this feature builds the detail read that such a surface would need.
- Ranking, scoring or recommending Channels from the statistics. The Operator sorts; the
  deployment does not advise.
- Computing statistics for followed Channels from the corpus Posts. That is the Channels tab, and
  it reuses this transform rather than adding a second one.
- Surfacing Directory statistics on the Channels tab, for the same reason.
- Probe-on-demand from the panel.
- Backfilling the latest Post id for seeded entries.
- Changing what a Discovery report is, how its Candidates are scanned, or how signals are
  weighted.
- Parsing the subscriber count into a stored integer. The existing string plus the existing
  parser on both sides continues to serve; a stored integer is a schema change with no caller.
- Downloading sample media, or showing thumbnails in the panel.
- Server-side sorting or pagination of a report.
- Any change to retention windows for entries, samples or Posts.

## Further Notes

The vocabulary change is recorded in `CONTEXT.md`: **Reference** is added, with `sample post`
listed as the term to avoid, and **Directory entry** is sharpened to name the derived statistics
alongside the metadata and the verdict. The individual statistic names stay out of the glossary,
because a glossary of eight metrics is a spec rather than vocabulary.

One decision earns an ADR: storing the statistics at probe time rather than deriving them on read
from the samples. It is hard to reverse (a migration and a backfill), surprising to a reader who
would expect a derivation from data sitting right there, and the result of a genuine trade-off,
since the read-time version blanks exactly the entries whose statistics matter most. Every other
decision here is either obvious in hindsight or cheap to undo.

The counters-count-media-items finding is worth remembering beyond this feature. It was not
documented anywhere and only turned up by reading the scrape site; any future work that treats
those four numbers as Post counts will be wrong in the same way.
