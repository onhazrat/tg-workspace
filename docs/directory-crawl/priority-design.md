# Directory crawl priority: current thinking

Status: proposal, nothing decided or built (2026-10-15). It brings together the
investigation in [how-the-crawl-works.md](how-the-crawl-works.md), the numbers
in [staging-measurements-2026-10.md](staging-measurements-2026-10.md) and the
literature in [research/report.md](research/report.md). Where a formula is our
own derivation rather than a published result, the text says so.

## The problem in one paragraph

The crawl does what DDS-02 asked of it, and that is the trouble. It walked into
the densest part of the Telegram graph, which is Russian, while the
deployment's readers follow Persian and English. It keeps every live channel it
finds on a 7-day refresh forever, and it orders work with constant priority
bands, so any new handle beats any refresh. On staging that came to 973k rows,
123k refreshes overdue, about 80k probe Requests a day on proxies that sync
shares (sync fetches went from 0.9 s to 23-28 s) and a disk 91% full.

## What we want

1. Probe the new handles most likely to be a live channel that the
   deployment's readers care about, first.
2. Refresh the channels whose refresh is worth the most, first, and stop
   paying weekly for channels that never change.
3. Split the probe budget between discovery and refresh on purpose, so neither
   one starves the other.
4. Let the site Owner steer both from the Directory tab, without touching code.

## What we learned, briefly

- **Production crawlers have no value-aware frontier.** Nutch, StormCrawler,
  Heritrix, BUbiNG, Frontera, Common Crawl and ManifoldCF all sort on one key
  and add caps. Their mechanisms are worth copying: Heritrix sheets,
  `precedenceFloor`, Nutch `fixedInterval`, Common Crawl's rank-to-budget
  interpolation, and ManifoldCF's indexed priority column. The scores come
  from the papers.
- **Raw backlink counts lose to random** (Baeza-Yates 2005: 0.50 against 0.50).
  Distinct citers are the spam-resistant version, and our live rates rise with
  them (43% to 78%).
- **Citer language is the strongest relevance signal.** 83% of Telegram
  forwards stay within one language (TeraGram), and on staging fa/en-cited
  targets yielded about 6.5x more wanted channels per probe. Every published
  Telegram snowball crawl ended up mostly Russian, so our drift is the
  expected result of greedy in-degree.
- **Hop distance does not help.** 95% of the wanted channels are 3 or more hops
  out.
- **Proportional refresh is the worst policy** (Cho & Garcia-Molina: freshness
  0.12 against 0.62 optimal). Binary-freshness optima give zero refreshes to
  fast, low-value items. Kolobov's harmonic penalty fixes that.
- **Telegram is easier than the web for refresh.** A fetch gives the exact
  number of new posts (the `latest_id` delta), so a posting rate has a
  closed-form estimate.
- **The discovery/refresh split has no published optimum.** It is a policy
  number, and a strict order between the two classes is the starvation pattern.

## Proposed design

### Free verdicts before any fetch

Seal a handle as dead without probing it when it ends in `bot` (Telegram rule,
99.7% dead on staging) or fails `^[a-z0-9_]{5,32}$`. Recheck it after 180 days,
because Telegram reclaims usernames.

### Discovery score

Use expected wanted channels per probe, written into the existing integer
`priority` column so `dequeue_handles` keeps its `ORDER BY`. The sign has to
flip, because lower currently sorts first.

```
EV(h)       = boost(h) · P(live | cell) · Σ_ℓ v_ℓ · P(lang = ℓ | citers)
cell        = best kind {forward, reply, link, mention-only} × distinct-citer bucket {1, 2-4, 5-19, 20+}
P(live|cell)= (live_cell + 1) / (probed_cell + 2)              smoothed, refit from the probe log
P(ℓ|citers) = (Σ_c a_c·[lang_c = ℓ] + m·π_ℓ) / (Σ_c a_c + m),   m = 2, π = language mix of live entries
a_c         = q_c / log2(2 + out_c)                            per distinct citer
q_c         = (live targets of c + 1) / (probed targets of c + 2)   citer precision
v_ℓ         = Owner-set language values, default from the follows' languages (fa, en = 1; others 0.1-0.15)
```

The literature behind each term:

- The kind × citer cell is Aggarwal's interest ratio, estimated jointly so two
  correlated signals are not double counted.
- The `m·π` floor plays the role of Shark-search's decayed inheritance, so a
  Persian channel cited only by Russian channels stays reachable.
- `a_c` is OPIC's split by out-degree, damped by a log and weighted by citer
  precision (Yandex's source-quality idea). Promo channels that list hundreds
  of dead handles lose weight on their own.

EV is recomputed from the current citation tables after each harvest batch and
in a full nightly pass. It is never accumulated, which is how Nutch's OPIC
scores inflated.

Later, once exploration labels exist, a logistic regression on the probe log
can replace the cell table. It has the same log-odds form and handles
correlated features. Candidate features: kind indicators,
`log(1 + distinct citers)`, citer-language shares, citer subscribers, days
since the newest citation, and handle shape.

### Refresh schedule

Estimate each channel's posting rate from exact counts. This is standard
Poisson statistics, our derivation:

```
on each observation j (a probe, or a sync of a followed channel):
  N_j = latest_id_j − latest_id_{j−1}        new posts (deleted posts inflate this slightly)
  a_j = days since the previous observation
  S = d·S + N_j ;  T = d·T + a_j ;  d = exp(−a_j / 60)    forget old evidence
  λ̂ = (α + S) / (β + T)                      prior from the first probe's visible posts
```

Then choose the refresh time from a value that grows without a ceiling. This
is our derivation from Olston & Pandey's threshold rule, and it is untested:

```
U(τ)       = w · (τ − ln(1 + λ̂τ) / λ̂)       τ = days since last fetch
w          = boost · v_lang · (1 + log10(1 + subscribers)) · (1 + harvest_yield)
next_due   = t_last + clamp(τ* where U(τ*) = Λ, 1 day, 60 days)
Λ          = tuned weekly so Σ 1/τ* ≈ the refresh budget
```

For slow channels U behaves like `wλτ²/2`, the binary-freshness value Google
uses. For fast channels it behaves like `wτ`, Cho's uniform allocation. It
never saturates, so no channel starves. At τ = 7 days, a 10-posts-a-day
channel scores 6.57 and a daily poster 4.92, a 1.3x gap rather than the 10x of
proportional allocation.

`harvest_yield` (new wanted handles found in a channel's past refreshes) puts
Dasgupta's result into practice: monitor the sources that keep revealing new
items.

`next_due` is stored when a verdict is written, so the dequeue stays a plain
indexed `ORDER BY next_due`. Dead and non-channel rows run on a separate
Nutch-style backoff (30 days, ×1.5 per miss, capped at 180) and never touch
λ̂.

### Capacity split and exploration

- An Owner-set refresh share `r`, default 0.5, raised to 0.65 in a catch-up
  mode while more than 10k live channels are 7 or more days overdue.
  Discovery gets `1 − r`.
- Work-conserving: slots one side cannot fill go to the other.
- 10% of discovery goes to handles drawn uniformly at random from the gated
  frontier. This crosses into communities the score has not reached and gives
  unbiased training labels. Flag those probes `explored = true`.
- At most K = 20 handles per batch from the same top citer.
- A daily ceiling on `tg_directory_probe_usage`, which today is only a tally.
- Index `(class, priority)` and `(class, next_due)`. ManifoldCF froze Postgres
  sorting a million rows without one.

The 0.5 is our sizing, not a published number. At 40k refreshes a day, the top
quarter of live channels can be refreshed weekly and the rest about monthly.

### Owner controls in the Directory tab

These are modelled on Heritrix sheets: a rules table of predicate, effect and
order, applied whenever EV, `w` and `next_due` are computed, and never baked
into the learned score.

| Effect | Applies to |
|---|---|
| Boost ×k, or demote ×0.2 | discovery and refresh |
| Exclude: keep and list the handle, never probe it | both |
| Fixed interval, e.g. daily | refresh |
| Min / max interval | refresh |
| Daily probe cap for the rule | both |
| Probe now (one-shot) | both |

The predicates reuse the Directory tab's filters: language, subscriber and
activity bounds, Tags, Seeds, Shared parents/children, explicit ticks from the
bulk bar, and a handle pattern. Boosts multiply across matching rules; for
every other effect the last matching rule wins.

Global settings: language values `v_ℓ`, refresh share `r`, exploration share,
EV floor, daily cap.

Permissions. Today every approved Account can use the Directory, and the
recheck and refresh routes have no Permission check. Once priority decides
where Telegram requests go, it is deployment policy, so it needs a new
Permission (something like `directory:manage`, held by Owner), and the
existing recheck route needs the same gate or a rate limit. Tags belong to one
Account, so a Tag only steers the crawl when the Owner explicitly promotes one
of their own.

Each row should get a "Why this priority" line, built the same way as DIR-07's
Why: P(live), the language term, w, λ̂, matching rules and next due. A queue
view shows probes per day by class, by exploration flag and by language.

### Disk

These are separate from priority, but needed:

- Don't download avatars for unfollowed handles at probe time. Load them when
  the Directory first shows the row, or link the CDN URL.
- Keep statistics and References for low-value entries, and drop their sample
  bodies.

## Build order

1. **Refresh share with overflow, the `bot` gate and the handle-shape gate.**
   This is the cheapest change with the largest effect: it drains the backlog
   before any score exists.
2. **Discovery EV** with the exploration slice and the per-citer cap.
3. **Exact-count rate estimator and adaptive `next_due`.** This needs `S`, `T`
   and the previous `latest_id` stored on the entry.
4. **Owner rules table, Permission, Why line, queue view.**
5. **Logistic model on the probe log**, once weeks of exploration labels exist.

The avatar change can go in at any point, and soon, because of disk.

## Open questions

- Is the language value per deployment, or should it also follow each
  Account's own follows?
- Exchange rate between "a new wanted channel" and "a stale channel's missed
  posts": is r = 0.5 right, and which dashboard number should re-tune it?
- Does the log-penalty utility behave on real data? It needs a replay against
  logged `latest_id` deltas before it becomes the scheduler.
- How much do deleted posts inflate `latest_id` deltas on busy channels?
- Should the Russian part of the Directory be kept at a low rate, frozen, or
  pruned?
- Should a probe of an unfollowed channel keep samples at all, given they are
  the largest table?

## Where to start next time

1. Re-run the queries in the measurements doc. The numbers move daily.
2. Read [research/report.md](research/report.md), then the note behind any
   formula you plan to implement (`research/notes/`).
3. Turn one build-order step into a spec with `/to-spec`.
