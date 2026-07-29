# IDEA-011: Discover tab refinement

| Field | Value |
|-------|-------|
| **Id** | IDEA-011 |
| **Status** | backlog |
| **Added** | 2026-07-29 |
| **Priority** | medium |
| **Area** | full-stack |

> This is a **survey document**, not a single unit of work. It holds fourteen
> proposals (D1–D14) grouped into eight workstreams. Each is independently
> shippable. When starting work, pick a workstream, not the whole document, and
> split it into its own `IDEA-NNN` if it grows a real spec.

---

## How Discover works today

Read this first — several proposals only make sense against the current shape.

> ⚠️ **This section describes the tab as surveyed on 2026-07-29, before W1 and
> D14 landed.** It is kept as the baseline the proposals argue against. What
> changed since: reports are saved artifacts opened from storage (there is no
> invalidation-on-scope-change), the aggregation has no client counterpart, and
> "View posts" is a side panel. See the W1 and D14 status notes.

**What it is.** A follow-recommendation engine built entirely from your own
scraped corpus, with no external index. It answers: *which channels do the
channels I already follow keep pointing at?*

**Scope** is mostly **not** Discover's own. Selected channels + date range come
from `UIContext`; `forwardedFilter`, `postSearch`, `mediaFilter`,
`maxPostsPerChannel`, and `semanticSearchQuery` come from `ScraperContext` and
are **shared live with the Posts tab**. Only three things are Discover-owned:
the signal chips, the result filters (`follow state` / `min hits` / `name`), and
sort — persisted via `frontend/src/lib/settings/schema.ts:241-258`.

**It is an action tab.** Nothing computes until *Generate Discovery Report*
(`DiscoverView.tsx:78`, `:138`). Any scope change resets `generated` to false
and discards the report (`DiscoverView.tsx:126-136`). This gating is
deliberate: opening the tab or clicking a channel must not trigger a corpus
scan.

**Aggregation** normally happens server-side in
`compute_discover_candidates` (`backend/app/services/discover.py:135`), behind
`POST /api/v1/discover/candidates` (`backend/app/api/routes/data.py:651`). It
streams posts with `yield_per=1000` ordered by `(channel_name, timestamp desc)`
— served by `ix_tg_posts_channel_name_timestamp` — applies the Posts-tab
filters plus the latest-per-channel cap, and extracts three signal kinds per
post:

| Kind | Source |
|------|--------|
| `forward` | `Post.forwarded_from` |
| `mention` | `@handle` regex over `Post.text` |
| `link` | `t.me/...` in text, scrape-time masked hrefs in `Post.links`, and `Post.reply_to.channel` |

Counting rules: at most one occurrence of each kind per handle per post,
self-references dropped, handles lowercased. Results accumulate per referenced
handle with a per-carrier breakdown, `lastSeen`, and a `samplePost` pointer.

**A parallel client implementation** (`computeDiscoveryCandidates` in
`frontend/src/lib/posts/discover-candidates.ts`) still exists for the two scopes
the server cannot currently reproduce: an active semantic query, and the
`random` per-channel cap mode (`SERVER_REPRODUCIBLE_CAP_MODES`,
`frontend/src/api/data.ts:102`).

**After the response**, the client applies follow-state / min-hits / name
filters and sorting locally, then renders a non-virtualized table. Selecting
rows starts a bulk-follow job (`backend/app/services/bulk_follow.py`,
`FOLLOW_SCRAPE_CONCURRENCY = 4`), which scrapes each channel, creates it with
`discoveredVia` provenance, and chains one sync job.

---

## W1 — Reports are saved artifacts

> **Decided 2026-07-29. Implemented 2026-07-29.** This workstream was originally
> three separate mitigations for "the report is easy to lose by accident". The
> agreed design replaces them with one structural change: **a Discover report is
> a stored entity, like a summary.** D3 dissolves entirely and D4 collapses to a
> snapshot. The original framings are kept below for traceability.
>
> **Status: built.** `tg_discover_reports` + `services/discover_reports.py`,
> routes under `/discover/reports`, Discover opens on the latest saved report,
> the D1 side panel replaces "View posts", and reports are archived in
> `HistoryView`. **D14 shipped alongside it**, so there is no unsaved-result
> caveat: every scope is aggregated server-side and therefore every report is
> saved.

### The design

Generating a report **saves** it. Selections on the Channels and Posts tabs are
its *input*, captured at generate time — after that the report is immutable and
is never recomputed by anything the user does elsewhere. A new report exists
only when the user explicitly asks for one. This is exactly the summary
lifecycle (`tg_summaries`, `services/summaries.py`), and Discover reports reuse
its shape.

Consequences:

- **No stale state.** A saved report is a record of *"these were the candidates
  for scope S at time T"*. Changing channel selection afterwards does not
  threaten it; it only means the *next* report will differ. The invalidation
  effect at `DiscoverView.tsx:126-136` is deleted rather than softened.
- **Scope stays shared.** `ScraperContext` needs no surgery. The report stores
  its own copy of the scope and `DiscoverScopeCard` renders **that**, not live
  state — which is the actual bug today, since after any change the card
  describes a scope the visible numbers did not come from.
- **`isFollowed` is not stored.** Candidate handles are joined against the live
  followed set at read time, so a report self-corrects as channels are followed.
  Counts are historical; follow state is live. Bulk-follow therefore stays
  enabled unconditionally, with no staleness caveat.

**Decisions taken:**

| Question | Decision |
|----------|----------|
| Evidence durability | Store the `samplePost` **pointer only**. Degrade gracefully when retention has pruned the post, and always offer a direct Telegram web-view link to the post so it stays investigable outside our corpus. |
| What is persisted | **Every** candidate, including the `total == 1` tail. `min hits` stays a view filter over the saved report, so nothing is lost and filters remain explorable after the fact. |
| Where reports live | **`HistoryView.tsx`**, alongside summaries and chat sessions. |
| Retention | **Manual delete only**, same as summaries. No auto-pruning. |

**How we can achieve this.**

*Backend*

- `DiscoverReport` table (`tg_discover_reports`) in `app/models_tg.py`, modelled
  on `Summary` (`:` string PK, `user_id`, `channels` JSON, `start_date`/
  `end_date`, `timestamp`, plus `signals`, the Posts-tab filter fields,
  `candidates` JSON, `scope_counts`, `posts_in_scope`). Alembic revision
  required.
- `app/services/discover_reports.py` with `create/list/get/delete`, mirroring
  `services/summaries.py` including its light-vs-full serialization split
  (`summary_to_camel_light` — a report list must not ship every candidate).
- Generation reuses `compute_discover_candidates` unchanged and persists the
  result; `isFollowed` is overlaid at read time, not stored.
- Routes alongside the existing `/discover/candidates`, which stays as the
  stateless compute path.

*Frontend*

- Discover loads the most recent saved report on open, with an explicit
  "Generate new report" action. Generating always creates a new report — it
  never overwrites.
- `HistoryView.tsx` gains reports as a third entity next to summaries and chat
  sessions, with open and delete.
- Retention pruning of posts must not orphan a report — the side panel shows
  "post no longer in your corpus" plus the Telegram link, never an error.

**Effort/risk.** Large — a new table, a migration, new routes, and two frontend
surfaces. The risk is scope creep into W4/W5: the side panel (D2) and result
paging (D10) are adjacent but separate.

---

### D1. Inspecting a candidate must not cost you your place

*Original framing: "View posts" destroys the report you are reading.*
`handleViewPosts` (`DiscoverView.tsx:274`) sets `forwardedFilter` **and**
`postSearch`. Both feed `serverParams` → `scopeSignature`, so the reset effect
fires and the report is gone — returning to Discover shows the Generate prompt
and costs another corpus scan.

**Why we may need this.** The most natural action in the tab — inspect the
evidence behind a candidate — is the one that discards the run that produced it.
On a large corpus the user pays a full scan to answer "why is this row here?",
and pays again to get back. It quietly teaches users not to inspect candidates
at all, which degrades their follow decisions.

**How we can achieve this.** **Decided: a side panel over Discover** — no
navigation, so nothing can be lost, and it is the natural home for D2's evidence
rendering. Once reports are saved the destructive-invalidation half of this is
moot, so D1 is now about not losing your *place* rather than not losing the
*run*. The panel shows the sample post (lazy-fetched via the pointer), the
per-carrier breakdown from `seenIn`, a Follow action, and a direct Telegram
web-view link that works even when the post has been pruned locally.

**Effort/risk.** Small–medium, frontend only. Existing e2e coverage in
`frontend/tests/summarizer.spec.ts` asserts the current navigation and will need
updating.

### D3. ~~Mark the report stale instead of wiping it~~ — superseded

*Original framing: the reset effect treats "scope changed" as "result is
worthless", so a stray keystroke in the Posts-tab search box silently discards a
completed aggregation.*

**Resolved by the saved-report design.** There is no staleness to label: a
report is immutable and scope changes cannot affect one that already exists. The
banner, the dimming, and the "disable follow while stale" question all disappear
with it. What survives from this item is the underlying complaint — a completed
full-corpus aggregation must never be discarded without the user asking — which
the saved-report design satisfies more completely than labelling would have.

### D4. ~~Give Discover its own scope~~ — reduced to a snapshot

*Original framing: `forwardedFilter` / `postSearch` / `mediaFilter` / cap are
shared live with the Posts tab, so runs are non-reproducible.*

**Resolved as intentional coupling.** Discover *should* operate on the current
channel and post selections — that is the feature, not the bug. The
non-reproducibility came from the report tracking those inputs *after*
generation, not from sharing them at generation. Storing the scope in the report
and rendering it from there fixes reproducibility with no `ScraperContext`
changes, so the "proper" decoupling described in the original item is explicitly
**not** being done.

---

## W2 — Rank by evidence quality, not raw volume

Two candidates with `total = 30` can differ enormously in how much they should
be trusted. Today the ranking cannot tell them apart.

### D5. Weight the signal kinds — **DONE 2026-07-29**

> Shipped as an additive "Weighted" sort; `total` was left alone rather than
> redefined, so no existing ordering changed and `minTotal` keeps its meaning.
> **Weights are user-editable** (defaults 3/2/1 forward/link/mention) rather
> than constants — the right ratio is corpus-specific. Scoring and re-sorting
> run client-side over the saved report, so a weight change re-ranks instantly
> with no regeneration. The editor is shown only while that sort is active, and
> a Score column appears with it so the ranking is explainable.
>
> Shipped alongside: **Min hits** became a free integer input instead of fixed
> 1+/2+/5+ buttons — the useful threshold depends on report size, and a wide
> scope's tail runs well past 5.

`total` is `forward + mention + link` with equal weight
(`discover.py:_to_candidate`, `discover-candidates.ts:337`).

**Why we may need this.** These are not comparable units of evidence. A
**forward** means a channel you trust republished that channel's content — a
strong, deliberate endorsement. A **link** is a deliberate reference but weaker.
A bare **@mention** may be a complaint, a namedrop, a disclaimer
("not affiliated with @x"), or spam. Summing them into one integer means a
mention-heavy noise channel can outrank a genuinely republished source, and the
default sort is `total`, so this is what most users see first.

**How we can achieve this.** Add a weighted score as an extra sort option rather
than redefining `total` (which would silently change every existing user's
ordering and break the `min hits` semantics). Start with a simple
`3·forward + 2·link + 1·mention`, computed alongside `total` in
`_to_candidate`, exposed as a new `DiscoverSortKey`. Make the weights visible in
the UI (a tooltip on the sort chip) so the ranking is explainable. Only consider
making it the default after the weights have been sanity-checked against a real
corpus.

**Effort/risk.** Small. Main risk is picking weights by intuition — see Open
questions.

### D6. Rank by independent corroboration, not volume

`seenInCount` is only a **tie-break** in `sortDiscoveryCandidates`
(`discover-candidates.ts:347`) and in the server's sort
(`discover.py:251`).

**Why we may need this.** A channel forwarded 50× by one chatty carrier
currently outranks one referenced 3× each by three independent carriers — even
though the second is the far better recommendation. This is the classic
single-loud-source problem: the ranking is dominated by whichever of your
followed channels posts the most, so Discover's top results drift toward "what
my noisiest channel talks about" rather than "what my sources agree on". As a
user follows more channels the problem gets *worse*, not better, which is the
opposite of what should happen.

**How we can achieve this.** Log-dampen the per-carrier contribution before
summing across carriers, e.g. `score = Σ_carriers log(1 + carrier_total)`. The
per-carrier breakdown is already computed (`_Accumulator.by_carrier`), so this
is arithmetic over data that already exists — no extra query cost. Ship it as
another sort option next to D5 and let the two be compared on a real corpus
before choosing a default. A TF-IDF-style variant (down-weight handles that
*everyone* links, like large news aggregators) is a possible follow-up but adds
a corpus-wide statistic, so keep it out of the first pass.

**Effort/risk.** Small, additive.

---

## W3 — Make the report improve with use

Discover is a recurring workflow, but it has no memory of previous runs. Its
signal-to-noise therefore degrades over time.

### D8. Dismiss / "not interested" list — **DONE 2026-07-29**

> `tg_discover_ignored`, keyed by the normalized handle. `isIgnored` is resolved
> live per read exactly like `isFollowed`, so a dismissal applies to every saved
> report at once — a report records what was *referenced*, not what the operator
> has since decided about it.
>
> Dismissed rows are hidden from All / Unfollowed / Followed and surface under a
> new **Ignored** filter. Hiding them everywhere is the point (a merely labelled
> row still costs attention), while the Ignored view keeps every dismissal
> reviewable and undoable rather than a silent blocklist. The stored report
> keeps the candidate row, or there would be nothing left to un-dismiss from.

**Why we may need this.** Every rerun re-surfaces everything you already
rejected. Because the good candidates get followed and disappear from the
unfollowed view, the report **fills up with your rejects over time** — the tab
gets monotonically less useful the more you use it, which is precisely backwards
for a recommendation surface. There is currently no way to express "I looked at
this and said no", so that judgement is lost on every run.

**How we can achieve this.** A small table — `tg_discover_ignored(handle,
reason, created_at)` in `app/models_tg.py` (`Channel` is at `:48`, `Post` at
`:87`) plus an Alembic revision. `compute_discover_candidates` already loads the
followed set as a single `select(Channel.name)`; load the ignored set the same
way and return `isIgnored` per candidate. Add a fourth option to
`DISCOVER_FOLLOW_STATE_OPTIONS` ("Ignored") and default the filter to hiding
them. Keep dismissal reversible and visible — a hidden, unreviewable blocklist
is worse than no blocklist.

**Effort/risk.** Medium — first Discover-owned persistent state, so it needs a
migration and an export/import story (`data_import_export.py`).

### D7. "New since last report"

**Why we may need this.** After the first run, the interesting information is
the **delta**. The all-time ranking is dominated by the same top channels every
time, so a user rerunning weekly has to re-scan a list they have already
triaged to find the handful of genuinely new references. This is the same
degradation as D8 approached from the other side, and together they are what
turn Discover from a one-shot tool into something worth opening regularly.

**How we can achieve this.** Once **W1** lands this needs no new storage — the
previous report's `timestamp` (and its candidate list) is already persisted, so
"new" can be derived by diffing against the last report for a comparable scope.
Before W1, persist the last-generated timestamp in the settings schema alongside
the existing `discover*` keys. Either way every candidate already carries
`lastSeen`, so v1 is a badge and a filter chip derived client-side. A stricter definition ("this handle was
never referenced before this run") needs the reference history from **D11** and
should wait for it.

**Effort/risk.** Small for the `lastSeen` version.

---

## W4 — Decide with facts, not just counts

The reference count tells you a channel is *talked about*. It tells you nothing
about whether it is worth following.

### D2. Show the evidence inline

The backend already returns `samplePost` (channel, postId, timestamp) and
nothing renders it.

**Why we may need this.** The decision "should I follow this?" is made from the
actual post, not from an integer. Today the only way to see it is D1's
report-destroying navigation, so in practice users follow on counts alone. We
are already paying to compute and transmit `samplePost` and getting zero value
from it.

**How we can achieve this.** Make table rows expandable: sample post text with
the matched handle highlighted, the per-carrier breakdown (already in
`seenIn`), and a direct t.me link. `samplePost` currently carries only a pointer
— either extend it with a text excerpt (cheap, but grows the response; see
**D10** on payload size) or fetch the body lazily on expand via the existing
posts endpoint. Prefer lazy fetch: it keeps the list response small and only
pays for rows the user actually inspects.

**Effort/risk.** Small–medium, mostly frontend.

### D9. Channel metadata before you commit — **DONE 2026-07-29, reworked 2026-07-30**

`get_channel_info` used to run only **during** the follow job
(`bulk_follow.py:273`), so following was a blind decision.

**Why we may need this.** You cannot see subscriber count, description,
language, or whether the channel even still exists before committing. The
consequences land after the fact: the bulk-follow job scrapes, creates rows, and
chains a sync for channels the user would have rejected on sight, and
`unavailable` is discovered at the worst possible moment. For a bulk-follow of
dozens of candidates that is real wasted scraping and real DB churn.

Delivery widened the goal. The operator's observation was that a large share of
candidates are not followable *at all* — bots, personal accounts, groups, and
private or deleted channels are referenced from posts exactly the way real
channels are, so the report asks for triage on rows that were never actionable.
That makes this a filtering feature, not just an informational one.

#### What shipped

* **`tg_discover_probes`** — one row per normalized handle recording what a
  single fetch of `t.me/<handle>` said: `status` (`ok` / `unavailable` /
  `unknown`), a best-effort `kind`, display name, bio, subscriber text.
* **A background sweep** at concurrency 2 — below bulk-follow's 4, because it
  runs unprompted and competes with sync for the same proxy lanes — probing in
  the report's rank order so the top of the list resolves first. Originally
  started from the browser when a report was opened; now a scheduled backend job
  draining a queue (see the reversal below).
* **A "Not followable" view**, kept *separate* from the D8 dismiss list. A probe
  is a fact about the handle; a dismissal is a judgement by the operator.
  Merging them would make an automated verdict indistinguishable from a
  deliberate one. A row carrying both flags appears only under "Ignored", so the
  two lists stay disjoint.
* **Recheck**, per row and in bulk, which clears the cached verdict and
  re-probes.

#### The second reversal: the client had no business orchestrating this

Shipped 2026-07-29, reworked the next day. The first version put "which handles
still need probing, and when does a sweep start" in a React effect
(`useDiscoverProbeSweep`) driving a short-lived in-memory job. That was wrong,
and the operator called it: the report is in the DB, the probed handles are in the
DB, and the fetch is issued by the backend — so the client only ever needed the
latest state to render, never a say in the orchestration.

Three defects followed from the placement, and the first could not be fixed
there at all:

1. **Closing the Discover tab stranded the report.** A sweep was capped at 400
   handles and the *client* chained the next batch from its poll loop. Generate a
   900-candidate report, navigate away, and 500 handles were never probed —
   indefinitely, silently. PR #50 tried to fix the chaining and could not fix
   this, because the thing doing the chaining lived in the browser.
2. **The dedupe and stop state were per-tab `useRef`s.** Two tabs re-requested
   the same handles, and "Stop" in one was not honoured by the other.
3. **`create_probe_job` had a check-then-act race across an `await`.** Two
   callers could both pass the "is a sweep running" check before either recorded
   one; the loser became an orphan sweep that the active-job endpoint could not
   see and Stop could not reach, burning proxy lanes until it finished. Reachable
   by a recheck click racing the auto-start effect, or just two tabs.

The tell was that the server already owned the real decision —
`handles_needing_probe`, with the cache check and the backoff clock — and the
client was re-deriving a worse copy of it from a possibly stale report, then
asking the server to re-filter the result. That is **exactly the D14 mistake**
(one rule, two implementations, the client's copy wrong) reintroduced four
workstreams later in a new place.

**What replaced it.** `tg_discover_probes` became the queue as well as the cache
— a `status="unknown"` row *is* a work item — with `priority` (candidate rank at
enqueue) and `retry_after` (materialized backoff deadline) making the dequeue one
indexable `WHERE`. `create_report` enqueues its candidates; a scheduled
`discover_probe` job drains a bounded batch per tick. Deleted: the in-memory job,
its four routes, the sweep hook, and the refs. The client keeps one query with a
conditional `refetchInterval`, one pure predicate, and two operator actions.

Registering it as an ordinary scheduler job carried most of the value: it
inherits enable/disable, manual trigger and last-run status, and APScheduler's
`max_instances=1` plus a module try-lock replaces the racy latch, so defect 3
stops existing rather than being patched. "Pause" became the job toggle —
durable, global, honoured by every tab — instead of a ref one tab ignored.

Two things worth being explicit about:

* **A queue entry is not an answer.** Enqueuing creates a row immediately, so
  `probe_map` omits rows that have never been attempted. Otherwise a candidate
  waiting its turn would read identically to one that failed three times.
* **Recheck had to become a requeue, not a delete.** Deleting the row used to be
  how recheck worked; under a queue model that removes the handle from the queue
  entirely and nothing ever fetches it again. The row is reset in place at
  priority 0.

**Accepted regression:** reports generated before 2026-07-30 keep whatever probe
rows they have, and their never-probed handles are never queued — there is no
backfill. Regenerating over the same scope enqueues them. Deliberate trade
against carrying a one-shot script for a day-old feature.

#### The reversal on prefetching

This section originally said **do not prefetch the whole table** — one scrape
per candidate row was the load pattern the bulk-follow investigation warned
about. That advice assumed the cost recurred per report. With a global
per-handle cache it does not: `handles_needing_probe` drops anything already
resolved, so a handle is fetched once and never again, and the steady-state cost
across reports approaches zero. The first sweep on a fresh install is the only
expensive one. The original reasoning was right about the cost; it was wrong
about the frequency.

#### The rule that matters most

A verdict is written **only** when a Telegram page actually parsed
(`isTelegramPage`). Timeouts, HTTP errors and proxy block pages record `unknown`
with an attempt count and exponential backoff instead.

This is the whole reason the design is safe. Because a conclusive answer is
cached indefinitely, writing a verdict from a failed fetch would permanently
hide a real channel from every future report, with nothing on screen to hint
anything went wrong. An `unknown` costs a retry; a wrong `unavailable` costs a
channel, silently. Recheck exists as the second line of defence.

#### Known limits

* `kind` is HTML heuristics over presentation markup Telegram can restyle, so it
  is **secondary**: it words a badge, never decides what gets hidden. `unknown`
  is an ordinary outcome. The one firm rule is the bot check — Telegram requires
  bot usernames to end in `bot`.
* The proportion of junk handles in a real corpus was never measured before
  building; the feature was scoped on the operator's observation. The queue's
  `resolved` / `unavailable` counts now make that ratio observable in staging.
* A permanently unreachable handle retries forever at the 24h backoff ceiling, so
  the `retrying` count need never reach zero. That is why the progress bar keys off
  `queued` alone and reports `retrying` as a separate line — on a healthy install
  it is absent, which makes its presence a real proxy-pool signal.
* Effect wiring is still untested: the repo has no `@testing-library` or
  `renderHook`, and component tests render to static markup, so no effect, state
  or timer behaviour runs. Keeping the remaining client logic to one pure
  predicate (`shouldPollProbeQueue`) is a deliberate response to that — it is the
  only shape that *can* be covered here, and the state machine it replaced had no
  coverage at all.

---

## W5 — Response and render shape

### D10. Push filters, sort and paging to the server

The response is unbounded: every candidate including the long `total == 1` tail.
`followState`, `minTotal`, `nameQuery` and sort are all applied **client-side**
in `DiscoverView.tsx:213-226`, i.e. *after* transfer.

**Why we may need this.** Every filter that shrinks the result runs after we
have already paid to serialize, transfer and hold the full set — and the table
(`DiscoverCandidateTable.tsx:70`, `min-w-[900px]`) is not virtualized, so a
wide-scope report renders thousands of DOM rows. This is the same unbounded
payload pattern that caused the bulk-follow RAM/CPU problem
(`docs/discover-bulk-follow-load-investigation.md`), reached by a different
route. It has probably not bitten yet only because most users generate over a
narrow scope; it will scale badly exactly when Discover becomes most useful
(many channels, long range).

**How we can achieve this.** Two independent halves — do both, in either order:

- **Server:** add `minTotal`, `followState`, `nameQuery`, `sort`, `limit`,
  `offset` to `DiscoverCandidatesRequest` (`data.py:582`). The aggregate is
  built in Python so the filter/sort/slice happens on the accumulator
  dictionary before serialization — no SQL change needed for v1. Note the
  aggregation still *scans* everything; **D11** is what fixes that.
- **Client:** virtualize the table. `@tanstack/react-virtual` is already a
  dependency (`frontend/package.json:40`), so this needs no new package.

**Effort/risk.** Medium. Moving filters server-side makes each filter change a
network round-trip — debounce `nameQuery`, and consider keeping name filtering
client-side within the current page for responsiveness.

---

## W6 — Stop recomputing what never changes

### D11. Materialize post references at scrape time

**Why we may need this.** Every Generate re-runs regex extraction over every
post body in scope. Posts are **immutable once scraped** and the parse is
deterministic, so this is pure repeated work — the same post is re-parsed on
every run, by every user, forever. It also caps what the rest of this document
can do: **D6**'s corroboration scoring, **D7**'s strict "never seen before", and
any notion of trend over time all become cheap `GROUP BY`s against a
precomputed table, and stay expensive full scans without one. This is the single
highest-leverage item here, and also the largest.

**How we can achieve this.** A `tg_post_references(post_id, channel_name,
handle, kind)` table, written in `upsert_posts`
(`backend/app/services/posts.py`, insert at `:99`, update path just above) by
calling the **existing** `post_references()` from `discover.py:94` — the parsing
logic moves nowhere, only its call site. Discover then becomes a `GROUP BY
handle` over an index. Needs:

- an Alembic revision plus a backfill script in `backend/scripts/`
  (`--dry-run` first, per the existing convention);
- reference rows recomputed on the post-update path, since `text`/`links` can
  change on re-scrape;
- coexistence during rollout — keep the scan path behind a flag until the
  backfill is verified to produce identical counts.

**Effort/risk.** Large. Highest payoff, and the only item here that needs a
backfill of the whole corpus. Worth its own `IDEA-NNN` when picked up.

---

## W7 — One implementation, not two

### D14. Delete the client aggregation path — **DONE 2026-07-29**

> Shipped with W1. Both halves landed as described below. `random` now sends
> `maxPerChannelMode` + `seed` and reuses `posts.random_cap_order`; a semantic
> query sends an explicit `postIds` set (empty list = "matched nothing", which
> is distinct from absent). `computeDiscoveryCandidates`, `postReferences`,
> `countPostsBySignal` and `SERVER_REPRODUCIBLE_CAP_MODES` are deleted, and the
> saved report stores `maxPerChannelMode` / `seed` / `scopedPostCount` so a
> randomly-capped or semantically-scoped report is still reproducible.
>
> The TS tests were not ported — `backend/tests/services/test_discover_candidates.py`
> already covered every aggregation case (and more: replies, invite links,
> reserved paths, the email false-positive guard). The kept TS tests are sort,
> result filtering, and `deriveDiscoveryEmptyReason`, none of which moved.
> New coverage: `backend/tests/services/test_discover_scope_modes.py`.

`computeDiscoveryCandidates` (TS) duplicates counting rules that
`discover.py`'s module docstring describes as "preserved verbatim" from it —
maintained solely for two fallback scopes.

**Why we may need this.** Two implementations of subtle counting rules
(one-occurrence-per-kind-per-post, self-reference exclusion, invite/reserved
path handling, the mention false-positive guard) **will** drift, and the drift
will be silent: the same scope quietly returns different numbers depending on
whether a semantic query happens to be set. "Verbatim" is a comment, not a
constraint. It is also a standing tax on every change in this document — D5, D6,
D8 and D10 each have to be built twice or deliberately made inconsistent.

**How we can achieve this.** The gap is narrower than it looks:

- **`random` cap:** already solved server-side.
  `_random_cap_order` (`backend/app/services/posts.py:123`) is a deterministic
  seeded ordering used by the posts feed. `DiscoverCandidatesRequest` extends
  `PostScopeRequest`, which carries **no** `maxPerChannelMode` or `seed`
  (`data.py`) — that omission, not a real limitation, is why `random` falls back
  to the client. Add both fields, reuse the same ordering, and drop `random`
  from `SERVER_REPRODUCIBLE_CAP_MODES`.
- **Semantic query:** either accept an explicit `postIds` list in the request
  (the client already has the semantic result set), or have the endpoint run the
  RAG search itself. `postIds` is the smaller change and keeps semantic ranking
  in one place.

Once both land, `computeDiscoveryCandidates` and the `serverEligible` branch in
`DiscoverView.tsx:90` can be deleted, along with `clientPosts` and the
`getScopedPosts()` call in `handleGenerate` — which also removes the last path
that pulls full post bodies into the browser.

**Effort/risk.** Medium, and it *removes* code. The random-cap half is small and
worth doing on its own. Port the TS unit tests
(`discover-candidates.test.ts`) to the Python suite before deleting.

---

## W8 — Cheap wins

### D12. Cache the link regex

`_text_link_re()` (`discover.py:41`) rebuilds the domain alternation —
`"|".join(re.escape(d) for d in _all_web_domains())` — on **every call**, and it
is called once per post plus once per link URL. `re.compile` itself is cached
internally by the `re` module, but the join/escape and tuple construction in
`_all_web_domains()` are not.

**Why we may need this.** It is per-post overhead in the hot loop of a
full-corpus scan, for a value that changes only when
`settings.TELEGRAM_WEB_DOMAIN` changes — i.e. never at runtime.

**How we can achieve this.** `functools.lru_cache` on `_text_link_re` (and
plausibly on `_all_web_domains` in `telegram_web.py:40`). One line each. Note
`telegram_web_domain()` reads in-memory `settings`, not the DB, so this is
overhead — not a per-post query. Verify no test mutates the domain at runtime
before caching.

**Effort/risk.** Trivial. Do it opportunistically alongside anything else in
`discover.py`.

### D13. Stream generate progress over SSE

**Why we may need this.** Generate is a single blocking POST behind a
react-query spinner: no progress, no ETA, no cancel. On a large scope the user
cannot distinguish "working" from "hung", and the only way out is a page
reload — which, per **D3**, also loses the report. Note this becomes much less
important if **D11** lands, since the scan stops being slow.

**How we can achieve this.** The infrastructure exists — sync uses
`POST /api/v1/jobs/sync` → `GET /api/v1/jobs/sync/{id}/events` with a one-shot
reconnect fallback (ADR referenced in `CLAUDE.md`). Discover could follow the
same shape, emitting posts-scanned progress from the `yield_per` loop.

**Effort/risk.** Medium. **Sequencing note:** do not build this before D11 — if
D11 makes generate fast, this is wasted work on a job that no longer needs a
progress bar.

---

## Suggested sequencing

| Order | Items | Rationale |
|-------|-------|-----------|
| 1 | **W1** (saved reports) + **D1** side panel | Agreed design; makes a generated report durable, which everything below benefits from |
| 2 | **D2** | Renders evidence we already fetch, into the panel D1 builds |
| 3 | ~~**D5**~~ (done), **D6** | Additive sort options, no migration, immediately visible quality gain |
| 4 | ~~**D8**~~ (done), **D7** | Turn Discover from one-shot into a recurring tool; D7 gets easier once report history exists |
| 5 | ~~**D14**~~ (done), **D12** | Small, subtractive, reduce the cost of everything after |
| 6 | **D10** | Before scope grows enough to hurt — note W1 persists the full tail, so this becomes about transfer and render, not storage |
| 7 | **D9** | Larger UX change; needs rate-limit care |
| 8 | **D11**, then **D13** if still needed | Own idea id; backfill required |

---

## Success criteria

- [x] A generated report is saved and survives any change to channel or post
      selections; only an explicit action creates a new one
- [x] Inspecting a candidate never costs the user their place in the report
- [x] A report's scope card describes the scope it was generated for, not live state
- [x] `isFollowed` on a saved report reflects the live followed set, not the
      value at generate time
- [x] A pruned sample post degrades to a Telegram link, never an error
- [x] Candidate ranking can distinguish a forward from a mention (D5)
- [ ] ...and one loud carrier from several independent ones (D6)
- [x] Dismissed candidates stay dismissed across runs
- [ ] A wide-scope report neither transfers nor renders its full long tail
- [x] Discover candidate counts are produced by exactly one implementation

## Non-goals

- External channel discovery (directories, search engines, Telegram's own
  recommendations). Discover is corpus-derived by design.
- Automatic following. Every follow stays a deliberate user action.
- Changing the scraping/sync architecture. D9 and D11 hook existing paths;
  neither introduces new scraping cadence.
- Per-user scoping. Mode A (single operator) stands (ADR / `CLAUDE.md`).

## Open questions

- ~~Are the Posts-tab-shared filters (D4) intentional or incidental coupling?~~
  **Answered 2026-07-29: intentional.** Discover should operate on the current
  channel and post selections; the report snapshots them at generate time. See W1.
- Should saved reports be included in export/import
  (`services/data_import_export.py`), as summaries are? Not decided.
- What weights for D5, and log base/damping for D6? Both should be validated
  against a real corpus before either becomes the default sort.
- Should a dismissal (D8) be permanent or expire? A channel rejected a year ago
  may be worth reconsidering.
- Does D10's server-side filtering justify the round-trip per filter change, or
  should filtering stay client-side within a server-paged window?
- Does `tg_post_references` (D11) belong in export/import
  (`data_import_export.py`), or is it derived data that should always be
  rebuilt from posts?

## References

- `frontend/src/components/DiscoverView.tsx` — orchestration; `:78` generate
  gate, `:126-136` scope reset, `:274` `handleViewPosts`
- `frontend/src/components/discover/` — `DiscoverScopeCard`, `DiscoverFilterBar`,
  `DiscoverSortChips`, `DiscoverCandidateTable`, `DiscoverBulkBar`,
  `DiscoverEmptyState`, `useDiscoverFollowJob`
- `frontend/src/lib/posts/discover-candidates.ts` — client aggregation, sort
  (`:315`), filters (`:363`, `:374`); `discover-selection.ts`,
  `discover-empty-state.ts`
- `frontend/src/hooks/useDiscover.ts`, `frontend/src/hooks/queryKeys.ts:15`
- `backend/app/services/discover.py` — `post_references` (`:94`),
  `compute_discover_candidates` (`:135`), `_text_link_re` (`:41`)
- `backend/app/api/routes/data.py:582,651` — request model and route
- `backend/app/services/bulk_follow.py` — follow job; `get_channel_info` at `:273`
- `backend/app/services/posts.py:99` (upsert), `:123` (`_random_cap_order`)
- `backend/app/services/summaries.py` + `Summary` in `models_tg.py` — the
  storage/lifecycle template W1 follows
- `frontend/src/components/HistoryView.tsx` — where saved reports will be listed
- `docs/discover-bulk-follow-load-investigation.md` — prior load work on the
  same feature area

## Session log

| Date | Notes |
|------|-------|
| 2026-07-29 | Created — full read-through of the Discover path; 14 proposals captured, no code changed |
| 2026-07-29 | W1 redesigned with the user: reports become saved artifacts modelled on summaries. D3 superseded, D4 reduced to a snapshot, D1 settled as a side panel. Four storage decisions recorded in W1. |
| 2026-07-29 | W1 implemented (backend + frontend). Migration `u3v4w5x6y7z8`. |
| 2026-07-29 | D5 (weighted sort, user-editable weights, client-side re-ranking) + Min hits as a free int; D8 (dismiss list, migration `v4w5x6y7z8a9`). |
| 2026-07-29 | D14 implemented and the alembic head resolved: `origin/main` merged into the branch and `u3v4w5x6y7z8` re-chained onto `s1t2u3v4w5x6`, so there is a single linear head. |
