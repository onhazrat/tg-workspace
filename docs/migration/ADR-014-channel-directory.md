# ADR-014: The probe cache becomes the Channel Directory

**Status:** Accepted (2026-09-06). Extends
[ADR-009](./ADR-009-server-authoritative-data.md), which moved Discover's
aggregation to the server; this decides what the resulting knowledge *is* and
where it lives. Tickets and their long-form reasoning:
`.scratch/channel-directory/` (spec plus issues 01–04).

## Context

`tg_discover_probes` existed to answer one narrow question. A Discover report
surfaces every handle the posts in your Scope point at, and most of those are
not channels anyone could follow — bots, personal accounts, groups, and private
or deleted channels are referenced from posts exactly the way real channels are.
One fetch of `t.me/<handle>` per handle sorted them automatically instead of by
hand on every report. The table was a triage cache, named for the job that
filled it.

Two things were wrong with leaving it there.

**The fetch was mostly thrown away.** Every probe pulls the channel preview
page — the subscriber and media counters, the numeric chat id, and the twenty
most recent posts are all paid for, in a request, a proxy Lane and its latency —
and the write path kept the verdict and discarded the rest. An operator could
see that a candidate was followable and nothing about whether it was alive, what
it published, or when it last posted.

**The deployment only knew what somebody had asked about.** A handle entered the
table only when a report named it, so everything else a Post referenced — every
forward, every mention, every `t.me` link — stayed invisible until an account
happened to run a scan over the right Scope. There was no answer to "what
Channels do we know exist", so there was nothing to browse, nothing to rank, and
no way to tell a thriving channel from one that stopped posting eight months
ago.

Both are the same gap: the deployment had a **cache of answers to questions
people asked**, and what it needed was a **map of what exists**.

## Decision

**`tg_discover_probes` is promoted, in place, to the Channel Directory.** It
becomes `tg_channel_directory`, its model becomes `DirectoryEntry`, and its
service becomes `services/channel_directory.py`. It keeps its normalized-handle
primary key and its `Scope.CORPUS` classification, both of which were already
exactly a map's shape. Every existing verdict survives the rename, so no handle
is re-probed for an answer already held (migration `b1c2d3e4f5a6`).

**`tg_channels` is not the Directory.** Extending it instead was considered and
rejected — see below, because this is the part that will look wrong to the next
reader. `tg_channels` keeps meaning "a Channel somebody follows and we sync",
including its four sync cursors.

**The Directory outlives Follows and Posts, and nothing is deleted because an
account acted.** Following a channel does not touch its entry or its samples.
Deployment-wide knowledge is not evidence about anybody's reading, so unfollowing
must not destroy it.

**The probe keeps what it already fetched.** Five metadata columns (`photos`,
`videos`, `files`, `links`, `telegram_chat_id`), named and typed to match what
`Channel` already carries so promoting an entry into a followed Channel needs no
translation. The parser already produced all five; only the write path discarded
them.

**Sample posts get their own table**, `tg_channel_directory_samples`
(`DirectorySample`, migration `f1a2b3c4d5e6`), modelled on `Post` and
deliberately not `tg_posts`. See Consequences.

**A conclusive verdict is no longer cached forever.** Dead verdicts — bot,
group, user account, private, deleted — are never re-probed, because those are
facts a timer cannot change. Live entries come due again after
`directoryRefreshDays`, deployment policy defaulting to a week, and that window
is the primary rate control on probe traffic (migration `a7b8c9d0e1f2`).

**The map fills itself.** A scheduled sweep walks stored Posts for referenced
handles not yet in the Directory and queues them, reusing the same signal
extractor a report uses (migration `b8c9d0e1f2a3`).

**Probe traffic is counted at deployment level and charged to nobody.**
`tg_directory_probe_usage`, one row per UTC day, no owner column.

## Why not extend `tg_channels`

The three reasons are specific, and none is aesthetic:

- **It is `FOLLOW_SCOPED`.** `services/tenancy.py` resolves its visibility
  through an `EXISTS` on the follow table, so a row nobody follows is visible to
  **nobody**. A map whose entire value is the channels you have *not* followed
  cannot live in a table whose scoping hides exactly those rows.
- **Retention actively collects its unfollowed rows.**
  `retention._collect_unfollowed_channels` deletes every Channel nobody follows,
  with its posts. Directory entries would be swept by the job whose correctness
  depends on doing so.
- **It sits on the auto-sync scheduler's hot path.** That path has already been
  narrowed once, from all 2,077 channels every 60 seconds — 69 minutes of
  database time per 10 hours — down to the six rows whose stats could change the
  answer (`sync_schedule.needs_dynamic_stats`). Adding an unbounded set of
  unfollowed rows to that table points straight at a regression already paid
  for.

At the domain level a Channel now spans followed and unfollowed alike, and
`CONTEXT.md` records that. **This ADR is only about which table carries which
half.**

## Consequences

- **Two tables now describe a channel, and that will read as duplication.** It
  is the load-bearing part of the decision: `tg_channels` is what somebody
  follows and we sync, `tg_channel_directory` is what exists on Telegram. The
  columns overlap on purpose so that promoting an entry needs no translation.
- **Samples are never promoted into `tg_posts`, and a followed channel's samples
  simply stop being maintained.** A `tg_posts` row belongs to a contiguous
  history the sync orchestrator tracks with anchors and sync state; a sample is
  an unversioned snapshot of one preview page, replaced wholesale. Sharing a
  table would force every feed, search, summary, embedding, retention and stats
  query to grow an exclusion predicate, and the first one that forgot would mix
  unfollowed channels into the corpus.
- **A payload with no samples key is not an empty sample set.** It came from a
  fetch that never parsed them and must leave an existing snapshot untouched.
  The `unavailable` verdict is the deliberate exception and carries an explicit
  empty list, because what Telegram just said *is* that there are no readable
  messages — a fact about the handle rather than a gap in what we fetched.
- **Directory metadata is kept indefinitely; only samples expire**, on
  `directorySampleRetentionDays`, separate from the corpus and log windows so
  tuning one does not move the others.
- **Probe traffic became something that runs unprompted.** Before the sweep, a
  probe happened because somebody generated a report. That is why the tally
  exists: an uncounted crawler is one you learn about from Telegram's response
  codes rather than from a dashboard.
- **The tally is not a Budget, and adding a fourth would break the three.**
  They derive totally from `SyncJobState.sync_mode`, so there is no mode a
  fourth could come from, and billing one account for corpus work is precisely
  what splitting the three exists to prevent.
- **Discovery reports are unchanged.** A report still scans the Posts in its
  Scope and joins Directory rows for metadata, exactly as it joined probe rows.
  A report answers what the channels *you* read point at — a personal question
  with a frozen Scope; the Directory answers what exists. Collapsing them would
  break the Artifact definition and lose the per-account signal counts the
  report is built on.
- **`ix_tg_posts_timestamp` was added to a 6.5 GB table** so the harvest walk is
  an indexed range scan rather than a seq scan and top-N sort on every tick.

## What this does not decide

**How the Directory is read.** A browsing, search or ranking surface over it is
a separate feature. This work builds the map; nothing in the product reads it
yet, which is why ticket 04 shipped no UI.

**Whether probe traffic needs a daily ceiling.** Deferred deliberately to the
adaptive per-proxy wait plus the refresh window. The known gap is that pacing
reacts after the fact and the widened wait is paid by whatever touches that
proxy next, including syncs. The tally added here is the instrument that would
show it; revisit with a week of its numbers rather than in advance.

**How fast the map should fill.** `DIRECTORY_HARVEST_SCAN_LIMIT` ships at 500
Posts per tick, which is conservative: on the staging corpus of 4.7M posts the
first full pass takes ~33 days. Raising it costs database reads only — outbound
requests are gated independently by the batch size and the backlog ceiling — so
it is an operator's dial rather than an architectural question.

**Whether sample media should ever be downloaded.** Samples are parsed but never
fetched, and the media-path rewrite that points thumbnails at the local cache is
skipped for them, because a probe never fills that cache and leaving the rewrite
in would render a broken image.
