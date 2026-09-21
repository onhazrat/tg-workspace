# Channel reference graph: plan

Spec: `.scratch/channel-reference-graph/spec.md`. Decisions:
[ADR-019](./migration/ADR-019-channel-reference-graph.md). Tickets:
`.scratch/channel-reference-graph/issues/`.

Status as of 2026-09-21: CRG-01 and CRG-02 landed. CRG-03 and CRG-04 remain,
and neither blocks the other.

## What this builds

A permanent table of References, one row per Post naming one Channel in one way,
filled from two sources that cost no Telegram requests: a sweep over stored Posts
and Directory samples mined at probe time. Nothing reads it in this effort.

## Sequence

| Ticket | What lands | Blocked by |
|---|---|---|
| CRG-01 | **Landed.** The tracer bullet: the table, its sole-writer service, the tenancy and retention classification, the extraction flag, the harvest tick's second walk, the defer-then-skip rule and its grace settings. Folds in two prefactors: the url helper that returns a post id, and a recheck that keeps the remembered chat id | none |
| CRG-02 | **Landed.** Sample mining at probe time, skip-not-defer | CRG-01 |
| CRG-03 | The forwarded-from post id columns and their scrape-time parsing | CRG-01 |
| CRG-04 | The backfill script and its first run | CRG-01 |

CRG-02, CRG-03 and CRG-04 are independent of each other and can be worked in
parallel once CRG-01 lands. The two prefactors sit inside CRG-01 rather than
standing alone because each is a few lines and both are useless until something
reads them.

Four PRs, one per ticket. A single PR carrying a migration, two write paths, a
scraper change and a backfill script gets reviewed by being merged.

## The three decisions that are hard to reverse

Argued in full in ADR-019. In one line each:

- **Per-occurrence rows, not weighted pairs.** A weight derives from occurrences
  with a `GROUP BY`; occurrences cannot be reconstructed from a weight.
- **Identity is the chat id.** Handles are reusable, so a handle-keyed graph
  merges two unrelated channels into one node the moment one renames.
- **Never pruned.** The `t.me` permalink still resolves after retention deletes
  our copy of the Post, so the graph is the durable artifact and the corpus is
  the replaceable one.

## The two facts that changed the design

Both look like the opposite is true, which is why they are written down.

**The harvest sweep is not a free ride.** `Post.harvested` is one-way and its
first pass finished during channel-directory ticket 05, so every existing Post is
already marked. Hooking reference extraction onto that flag would have seen only
newly scraped Posts, and resetting it meant refilling a partial index from empty
and waiting roughly a month at `DIRECTORY_HARVEST_SCAN_LIMIT` of 500 per
300-second tick against 4.7 million Posts. References get their own flag.

**Retention never touches `tg_posts.id`.** It deletes in bulk by
`(channel_name, post_id)`. So declining a foreign key to the Post costs nothing,
and adding one would have forced a retention change.

## Known holes, stated on purpose

- Forwards already in the corpus can never gain a target post id. The href was
  never stored. No backfill can invent it.
- A Post whose channel has no chat id produces no Reference. It is retried for a
  grace period, then skipped for good, and the sweep counts both so the gap is
  visible rather than silent.
- Directory samples get no deferral at all, because there is no per-row flag to
  defer with. The next probe re-mines them instead.
- The graph's kind vocabulary is one wider than `SignalKind`, because a
  cross-channel reply is `reply` here and `link` there. A parity test on the
  handle sets is what stops the two definitions drifting.

## Not in this effort

Routes, schemas, client regeneration and UI. Aggregation or precomputed weights.
A graph database. Any new scrape lane for deep-scraping unfollowed channels, and
any Telegram request spent resolving a missing chat id. Pruning of any kind.

Whether the crawler still goes idle after the free tier fills the graph is the
measurement that decides if a deep-scrape lane is ever worth building.
