# Spec: The Channel Directory

**Status:** ready-for-agent

Supersedes `docs/discover-candidate-posts-plan.md` (uncommitted), which re-specified PR #64 of
the old private repo as a storage-only change. That plan's premise held up under review; its
scope did not. This replaces it.

## Problem Statement

Every Discover probe fetches a Channel's preview page and throws most of the response away. The
counters, the numeric chat id and the twenty most recent Posts on that page are all paid for —
the request, the proxy Lane, the latency — and then discarded. The Operator sees a handful of
fields about a Candidate and cannot tell whether the channel is alive, what it actually posts,
or when it last posted.

Worse, the deployment only ever looks at handles that turned up in a Discovery report somebody
generated. Everything else a Post references — every forward, every mention, every `t.me` link —
is invisible until an Account happens to run a scan over the right Scope. There is no answer to
"what Channels do we know exist", so there is nothing to browse, nothing to rank, and no way to
tell a thriving channel from one that stopped posting eight months ago.

## Solution

A **Directory**: the corpus-wide map of every Channel anyone has seen referenced, followed or
not. Each **Directory entry** holds one Channel's metadata, its followability verdict, and a
sample of its recent Posts. The Directory outlives Follows and Posts on purpose, because it
records what exists on Telegram rather than what anybody reads.

It is built from work already being done. The probe keeps what it already fetched instead of
discarding it. A periodic sweep feeds the queue from references already extracted out of stored
Posts. Followed Channels refresh their entries for free, out of the metadata every sync already
fetches. Nothing here adds a request to any path an Account waits on.

## User Stories

1. As an Operator, I want a Candidate's subscriber count and media counters visible, so that I can judge its size without opening Telegram.
2. As an Operator, I want a Candidate's numeric chat id recorded, so that I can still recognise the Channel after it renames its handle.
3. As an Operator, I want to read a sample of a Candidate's recent Posts, so that I can judge what it actually publishes before following it.
4. As an Operator, I want to see when a Candidate last posted, so that I can skip channels that have gone quiet.
5. As an Operator, I want the Directory to cover Channels that never appeared in any of my reports, so that discovery is not limited to what I have already scanned.
6. As an Operator, I want handles referenced by forwards, mentions and links to enter the Directory on their own, so that the map fills in without me generating reports to drive it.
7. As an Operator, I want a Channel I follow to keep a current Directory entry, so that the map does not go stale on exactly the Channels I care most about.
8. As an Operator, I want the Directory to survive my unfollowing a Channel, so that removing it from my reading does not destroy deployment-wide knowledge.
9. As an Operator, I want a second Account's follow to have no effect on my view of the Directory, so that corpus knowledge stays separate from anybody's reading.
10. As an Operator, I want Directory entries refreshed on a schedule I control, so that I can trade freshness against load on my own proxies.
11. As an Operator, I want to widen the refresh window when Telegram pushes back, so that I have a lever short of turning the feature off.
12. As an Operator, I want handles with a dead verdict never re-probed, so that bots and deleted channels stop costing requests forever.
13. As an Operator, I want an entry I am looking at to be refreshable on demand, so that I am not reading week-old data while deciding whether to follow.
14. As an Operator, I want probe work to run only when no sync wants a Slot, so that building the map never delays the Posts I am waiting for.
15. As an Operator, I want to see how many requests the probe lane spent, so that a runaway crawl shows up on my dashboard rather than in Telegram's response codes.
16. As an Operator, I want probe requests kept off every Account's quota, so that nobody is billed for deployment-wide work.
17. As an Operator, I want Directory metadata retained indefinitely, so that the map is cumulative and gets more useful over time.
18. As an Operator, I want sample Posts expired on their own window, so that the expensive half of the Directory does not grow without bound.
19. As an Operator, I want the sample window configurable separately from log and corpus retention, so that tuning one does not silently move the others.
20. As an Operator, I want the Directory seeded from what the deployment already knows on first upgrade, so that it is useful immediately rather than after weeks of crawling.
21. As an Operator, I want my existing probe verdicts preserved through the rename, so that no handle is re-probed for an answer we already have.
22. As an Account, I want my Discovery report to still answer what the Channels I read point at, so that the report stays about my Scope and not the whole deployment.
23. As an Account, I want report Candidates enriched with Directory metadata, so that I get counters and samples without the report changing what it means.
24. As an Account, I want sample Posts kept out of my feed, search, summaries and embeddings, so that Channels nobody follows never contaminate the corpus.
25. As an Account, I want my dismissals unaffected by the Directory, so that a handle I hid stays hidden.
26. As a Sync worker, I want a Channel's Directory entry updated from the metadata I already fetch, so that freshness costs nothing extra.
27. As a Sync worker, I want followed handles skipped by the probe sweep, so that I am not fetching the same Channel twice by two routes.
28. As a Sync worker, I want refresh due-time stored separately from retry backoff, so that a slow queue cannot be mistaken for a failed fetch.
29. As a developer, I want the table named for what it is, so that the next person does not read "probes" and assume it is a Discover implementation detail.
30. As a developer, I want the sample Posts in their own table, so that no existing corpus query needs an exclusion predicate it could forget.
31. As a developer, I want the hot `tg_channels` table left out of this, so that the scheduler's per-tick cost does not regress.
32. As a developer, I want storage to land separately from crawling, so that the risky half can be reverted without losing the safe half.

## Implementation Decisions

### The Directory is the promoted probe table

`tg_discover_probes` becomes the Directory, renamed to reflect its role rather than its origin.
It keeps its normalized-handle primary key and its `Scope.CORPUS` classification, both of which
are already exactly a map's shape. Its model becomes `DirectoryEntry`.

**`tg_channels` is not the Directory.** Extending it was considered and rejected. It is
`Scope.FOLLOW_SCOPED`, so rows nobody follows would be visible to nobody; the unfollow-retention
guard asserts its rows are collected; and it sits on the auto-sync scheduler's hot path, which
this repo has already had to narrow once from thousands of rows to six. Adding an unbounded set
of unfollowed rows to that table points at a regression already paid for. `tg_channels` keeps
meaning "a Channel somebody follows and we sync", including its four sync cursors.

At the domain level a Channel now spans followed and unfollowed alike — see `CONTEXT.md`. This
decision is only about which table carries which half.

### Five metadata columns

The Directory gains `photos`, `videos`, `files`, `links` and `telegram_chat_id`, named and typed
to match the columns `Channel` already carries so that promoting an entry into a followed Channel
needs no translation. The counters stay raw text as Telegram renders them, for the reason
`subscribers` already does. The chat id is a big integer and is the only identity that survives a
handle rename.

The parser already produces all five. Only the write path discards them.

### Sample Posts get their own table

A new table holds a Directory entry's sample Posts, keyed by handle and post id, modelled on
`Post` but deliberately not `tg_posts`.

A `tg_posts` row belongs to a contiguous history the sync orchestrator tracks with anchors and
sync state. A sample is an unversioned snapshot of one preview page, replaced wholesale. Sharing
a table would force every feed, search, summary, embedding, retention and stats query to grow an
exclusion predicate, and the first one that forgot would mix unfollowed Channels into the corpus.
For the same reason samples are never promoted into `tg_posts` when a Channel is followed.

Dropped relative to `Post`: the owner column (the Directory is corpus-wide), the sync bookkeeping
fields (which would invite sync logic to trust these rows), and `updated_at` in favour of a
capture timestamp, because rows are replaced rather than edited.

### Nothing is deleted because an Account acted

Following a Channel does not touch its Directory entry or its samples. The Directory is
deployment-wide knowledge and one Account's reading choices are not evidence about it. Samples
for a followed Channel simply stop being maintained — the real Posts are in `tg_posts` — and age
out on the sample retention window like any other.

This removes the delete-on-follow plumbing the superseded plan specified across two
channel-creation paths.

### The parser opts in to samples

Meta parsing gains a flag for whether to also parse the preview page's Posts; the probe is the
only caller that sets it. Latest-post-id derivation is untouched, because it feeds handle-kind
classification and the unavailability check and must not be perturbed.

Sample media is parsed but never downloaded, and the media-path rewrite that points thumbnails at
the local cache is skipped for samples. A probe never fills that cache, so leaving the rewrite in
would render a broken image.

### Storing what the probe fetched

On a conclusive verdict the write path stores the five columns and replaces the handle's samples.
Replace, not merge: the preview page is a sliding window, so a Post that dropped off it should
stop being reported as recent.

**A payload with no samples key is not an empty sample set.** It came from a fetch that never
parsed them, and must leave an existing snapshot untouched. This distinction becomes load-bearing
once sync feeds the Directory, and needs a test of its own.

An inconclusive fetch touches nothing, matching the existing verdict rule. An `unavailable`
verdict clears the samples, which falls out of the replace naturally. A recheck resets the verdict
fields and leaves samples alone; the next conclusive probe replaces them.

### Refresh is tiered

Today a conclusive verdict is cached indefinitely — correct for followability, wrong for a map.

Dead verdicts (bot, group, user account, private, deleted) are never re-probed; the existing
argument holds untouched for them. Live Channels become due again after a configurable window,
defaulting to one week, with the window as the deployment's primary rate control: widening it is
how an Operator responds to pressure from Telegram. An entry can also be refreshed on demand when
somebody opens it.

Due-ness is a new column, deliberately not the existing retry-backoff field. That field means
"this fetch failed, back off"; refresh means "this answer is old". Same type, opposite cause, and
the one time they were conflated it produced a starvation bug the module still documents.

### Followed Channels refresh for free

Sync already fetches exactly the metadata the Directory wants on every Channel it syncs. That
metadata now also updates the Directory entry, at zero additional requests. Correspondingly the
probe sweep skips any handle somebody follows, removing the largest source of duplicate fetching.

Sync does not parse samples, so a followed Channel's samples stop being maintained — which is
correct, since its real Posts are in the corpus.

### Harvesting is a sweep, not a write on the sync path

A periodic job walks stored Posts for referenced handles not yet in the Directory and enqueues
them, reusing the existing signal extractor that already pulls forwards, mentions and links.

It is a sweep rather than an enqueue at ingest so that there is one throttle point with a batch
size to turn down, and so that building the map never slows the path an Account waits on.

### Rate and accounting

Work drains through the existing probe queue lane, which is ordered strictly after every sync
lane, and the sweep already refuses to enqueue while that lane holds anything. Combined with the
refresh window, that is the rate control.

No daily ceiling in this work. The adaptive per-proxy wait already widens under rejection and
soft blocks, which throttles a crawler by construction. The known gap is that it reacts after the
fact and the widened wait is paid by whatever touches that proxy next, including syncs; the
Operator's lever if that bites is the refresh window.

Probe-lane requests get a deployment-level counter and stay off every Account's quota ledger. A
fourth Budget is wrong — the three derive totally from sync mode — and charging an Account for
corpus work is what the existing three Budgets exist to prevent. But an uncounted crawler means
learning about a problem from Telegram rather than from a dashboard.

### Retention

Directory metadata is kept indefinitely; collecting it would throw away the map. Samples expire on
their own new deployment-policy setting, separate from log and corpus retention so that tuning one
does not move the others. Dead-verdict entries keep metadata forever and hold no samples anyway.

The setting is deployment policy, not per-Account, because the Directory is corpus-wide.

### Discovery reports are unchanged

A Discovery report still scans the Posts in its Scope and joins Directory rows for metadata,
exactly as it joins probe rows today. A report answers what the Channels *you* read point at,
which is a personal question with a frozen Scope; the Directory answers what exists. Collapsing
them would break the Artifact definition and lose the per-Account signal counts the report is
built on. A browsing surface over the Directory is a separate future feature.

### Seeding

The rename carries every existing probe row across, so no handle is re-probed for an answer
already held. The migration additionally seeds entries from `tg_channels` metadata, so the
Directory launches knowing every Channel anyone follows — the set most likely to be browsed
first. Seeded rows have no samples; the refresh window fills them in.

### Shipping

Two changes, landed separately.

The first is storage: the rename, the five columns, seeding, the sample table, storing what the
probe already fetches, and the sample retention window. It adds no outbound requests and has
nothing to tune.

The second is the crawler: refresh scheduling, sync feeding the Directory, the harvest sweep and
lane metering. Every risky decision lives here, in one revertible change.

Sample retention ships in the first change rather than the second, so samples never exist without
a window. An earlier draft deferred it purely to keep that change small, which would have left a
gap where they accumulated unbounded.

## Testing Decisions

A good test here asserts what a caller can observe — what a Directory entry holds after a probe,
what the parser returns, what survives a follow — and never how it was stored. Tests that assert
column presence or call ordering will break on the rename this spec already performs once.

### Seams

Two, both already established, no new ones.

**The probe write path** is the seam for everything about what a Directory entry stores. It has a
single production caller, so the job that calls it is one-line glue not worth its own tests, and
three existing test modules already drive it directly as a seam. Prior art:
`tests/api/test_discover_projection.py`, `tests/api/test_discover_probe_queue.py`,
`tests/jobs/test_discover_probe_sweep.py`.

**Channel info fetching** is the seam for whether the parser returns samples. Prior art: the
existing scraper meta tests.

Everything else is reached through those two.

### What to cover

Through the write path: a conclusive payload stores the five columns and the samples; a payload
with no samples key leaves an existing snapshot untouched; an inconclusive fetch touches neither
columns nor samples; an unavailable verdict clears samples; a recheck resets the verdict and keeps
samples; replace drops Posts that fell off the preview window; the camelCase projection carries
the new fields.

Through channel info fetching: samples absent unless asked for; latest-post-id identical either
way; sample media parsed with thumbnail paths *not* rewritten to local cache paths; counters and
chat id present on the meta dict.

Refresh and harvest, in the second change: a dead verdict never becomes due; a live entry becomes
due after the window; a followed handle is skipped by the sweep; sync updates an entry's metadata;
due-ness and retry backoff move independently.

Existing guards that must stay green, and one that must be extended: the tenancy classification
guard (the two new tables need a scope with a reason), the test-pollution inventory (both new
tables truncated between tests), the service-kind inventory (the new aggregate declares its kind),
and the route inventory if any route names change with the rename.

## Out of Scope

- A browsing or search surface over the Directory. This work builds the map; the UI that reads it
  is a separate feature.
- Ranking, scoring or recommending Channels from Directory data.
- Changing what a Discovery report is or how its Candidates are scanned.
- Promoting sample Posts into the corpus when a Channel is followed. Sync fetches the Channel
  properly instead.
- A daily ceiling on probe-lane requests. Deliberately deferred to the adaptive proxy wait plus
  the refresh window; revisit if Telegram pushes back.
- A fourth quota Budget, or charging any Account for probe requests.
- Downloading sample media or thumbnails.
- Retention for Directory metadata rows. They are kept indefinitely by design.

## Further Notes

The vocabulary is recorded in `CONTEXT.md`: **Directory**, **Directory entry**, **Candidate**, a
revised **Channel**, and **Queue lane** — the last resolving a real collision, since the glossary
defines a Lane as one proxy while the code also calls its queues lanes. The code keeps both
spellings deliberately; the lane migrations freeze their names as literals precisely so a rename
cannot reach them.

This design descends from PR #64 of the old private repo (IDEA-011 D16), which was storage-only
and written against a since-redesigned schema. The grilling session that produced this spec
established that the storage change and the map are the same feature, and that specifying storage
without the map would have built a table needing reshaping within months.

The decision to promote the probe table rather than extend `tg_channels` clears all three ADR
bars — hard to reverse, surprising without context, and a genuine trade-off — and should be
written up in `docs/migration/` alongside the implementation.
