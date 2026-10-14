# Nutch, StormCrawler and URLFrontier: how they prioritise new URLs and schedule re-fetches

Source snapshot: I read code and default config directly, not summaries. Apache Nutch `master` (fetched 2026-10-15; latest release 1.22, dated 12/02/2026 in `CHANGES.md`). Apache StormCrawler `main` at commit `0ba9c2e` (2026-10-14; package `org.apache.stormcrawler`, 3.x line, docs published for 3.5.1 to 3.7.0). crawler-commons/url-frontier `master` at `43c58c3` (2026-09-22). Raw GitHub URLs below point at those branches. Line numbers can drift.

Base URLs used in citations:
- Nutch: `https://github.com/apache/nutch/blob/master/...`
- StormCrawler: `https://github.com/apache/stormcrawler/blob/main/...`
- URLFrontier: `https://github.com/crawler-commons/url-frontier/blob/master/...`

---

## Q1. Nutch Generator: how top-N selection works, and how scoring filters plug in

### Takeaway
Nutch's Generator is a batch sort. A mapper drops anything not due (`FetchSchedule.shouldFetch`), still locked, filtered, below `generate.min.score`, or of the wrong status. It computes one float, the chained `ScoringFilter.generatorSortValue`, and emits `(sortValue, url)`. Reducers partitioned by host walk URLs in decreasing sort value and stop at `topN / numReducers`. They skip a host once it holds `generate.max.count` URLs (counted per `generate.count.mode`). The overflow can spill into the next of `generate.max.num.segments` segments. Priority is therefore a single global float. Per-host caps are applied after sorting, so a heavily boosted host still gets only `max.count` slots per segment.

### Cited Findings

**Selection pipeline (`src/java/org/apache/nutch/crawl/Generator.java`)**
- Property constants: `generate.update.crawldb`, `generate.min.score`, `generate.min.interval`, `generate.restrict.status`, `generate.filter`, `generate.normalise`, `generate.max.count`, `generate.count.mode`, `generate.topN`, `generate.curTime`, `crawl.gen.delay`, `generate.max.num.segments`, `generate.expr`, `generate.hostdb`, `generate.max.count.expr`, `generate.fetch.delay.expr` (lines ~100–117). [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)
- The `SelectorMapper.map` order of checks: (1) URLFilters if `generate.filter`; (2) `schedule.shouldFetch(url, datum, curTime)`, otherwise the "scheduleRejected" counter increments; (3) generate-lock: if the datum metadata `_ngt_` (generate time) + `crawl.gen.delay` > now, skip ("waitForUpdate"); (4) `sort = scfilters.generatorSortValue(key, datum, 1.0f)`; (5) optional Jexl `generate.expr` on the CrawlDatum; (6) `generate.restrict.status`; (7) `if (sort < generate.min.score) skip`; (8) `if (fetchInterval > generate.min.interval) skip`; then it writes `(FloatWritable sort, entry)` "invert for sort by score". [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)
- Sorting: `job.setSortComparatorClass(DecreasingFloatComparator.class)`, so highest sort value first. Partitioning: `job.setPartitionerClass(Selector.class)`, which wraps `URLPartitioner`, so each reducer sees whole hosts. [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)
- `SelectorReducer.setup`: `limit = generate.topN / job.getNumReduceTasks()`; `maxCount = generate.max.count` (default -1); `byDomain = "domain".equals(generate.count.mode)`. [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)
- Reduce loop: when `count == limit` it moves to the next segment if `currentsegmentnum < maxNumSegments`, otherwise it breaks. With `maxCount > 0` it keeps `hostCounts[hostordomain] = {segment, countInSegment}`. When `countInSegment > maxCount` it bumps the host to the next segment, or skips the URL once all segments are used. It logs "Host or domain {} has more than {} URLs for all {} segments. Additional URLs won't be included in the fetchlist" and increments `GENERATOR_URLS_SKIPPED_PER_HOST_OVERFLOW_TOTAL`. [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)
- CLI: `Generator <crawldb> <segments_dir> [-hostdb <hostdb>] [-force] [-topN N] [-numFetchers numFetchers] [-expr <expr>] [-adddays <numDays>] [-noFilter] [-noNorm] [-maxNumSegments <num>]`. [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)

**Defaults (`conf/nutch-default.xml`)** ([nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml))
- `generate.max.count` = `-1`: "The maximum number of URLs in a single fetchlist. -1 if unlimited", counted per `generate.count.mode`.
- `generate.count.mode` = `host` ("can be 'domain'. Note that we do not count per IP in the new version of the Generator").
- `generate.min.score` = `0`: "Select only entries with a score larger than generate.min.score."
- `generate.min.interval` = `-1` (disabled): select only entries with fetch interval lower than this.
- `generate.restrict.status` = empty: "Select only entries of this status" (NUTCH-1248).
- `generate.update.crawldb` = `false`: if false, "running generate twice without intervening updatedb will generate identical fetchlists".
- `crawl.gen.delay` = `604800000` ms (7 days): how long generated records stay locked. "If generate.update.crawldb is false the property crawl.gen.delay has no effect."
- `generate.hostdb`, `generate.max.count.expr`, `generate.fetch.delay.expr`: Jexl expressions over HostDB data to vary per-host max count and fetch delay (NUTCH-2368).
- `generate.max.per.host` no longer appears in `nutch-default.xml`. `CHANGES.md` records its history: NUTCH-108 "Log hosts that exceed generate.max.per.host", and NUTCH-1409 "remove deprecated properties db.{default,max}.fetch.interval, generate.max.per.host.by.ip". `generate.max.count` + `generate.count.mode` replaced it. [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)

**HostDB-driven variable caps (NUTCH-2368)**
- With `generate.hostdb` set, the reducer loads the whole HostDB into a `HashMap<String, HostDatum>`. For each new host it evaluates `generate.max.count.expr` with Jexl variables `dnsFailures, connectionFailures, unfetched, fetched, notModified, redirTemp, redirPerm, gone, conf`, plus any HostDatum metadata (float/int/text; dashes become underscores). The result overrides `maxCount` for that host. `generate.fetch.delay.expr` is stored on the datum as `_variableFetchDelay_`, which the fetcher reads. [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)
- Bugs fixed along the way: NUTCH-2420 "Bug in variable generate.max.count and fetcher.server.delay", NUTCH-2924 "Generate maxCount expr evaluated only once", NUTCH-2574 "Generator: hostCount >= maxCount comparison wrong", NUTCH-1155 "Host/domain limit in generator is generate.max.count+1", NUTCH-1074 "topN is ignored with maxNumSegments and generate.max.count". [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)

**ScoringFilter interface (`src/java/org/apache/nutch/scoring/ScoringFilter.java`)** ([ScoringFilter.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/scoring/ScoringFilter.java))
- `injectedScore(Text url, CrawlDatum datum)`: called by Injector for seeds.
- `initialScore(Text url, CrawlDatum datum)`: called in `CrawlDbReducer` for a newly discovered link (`STATUS_LINKED` with no old record), after `schedule.initializeSchedule`. [CrawlDbReducer.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/CrawlDbReducer.java)
- `float generatorSortValue(Text url, CrawlDatum datum, float initSort)`: the Generator sort key.
- `passScoreBeforeParsing` / `passScoreAfterParsing`: move score from datum to content metadata to parse metadata.
- `CrawlDatum distributeScoreToOutlinks(Text fromUrl, ParseData parseData, Collection<Entry<Text,CrawlDatum>> targets, CrawlDatum adjust, int allCount)`: set scores and metadata on outlinks, or drop them by clearing `targets`.
- `updateDbScore(Text url, CrawlDatum old, CrawlDatum datum, List<CrawlDatum> inlinked)`: called in updatedb with the inlinks received this cycle.
- `default void orphanedScore(Text url, CrawlDatum datum)`: called for records with no fetch and no inlinks this cycle (CrawlDbReducer: "set score for orphaned pages").
- `indexerScore(...)`.
- Chaining: `ScoringFilters.generatorSortValue` loops `initSort = filters[i].generatorSortValue(url, datum, initSort)`, so each plugin multiplies or transforms the previous plugin's value. `scoring.filter.order` (default empty, meaning system order) sets the order. [ScoringFilters.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/scoring/ScoringFilters.java); [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)

**Score-related link properties** ([nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml))
- `db.score.injected` = `1.0`; `db.score.link.external` = `1.0`; `db.score.link.internal` = `1.0`; `db.score.count.filtered` = `false` (divide by only the outlinks that passed filters); `db.max.outlinks.per.page` = `100`; `db.update.max.inlinks` = `10000` ("Only the best scoring inlinks are kept"); `db.update.additions.allowed` = `true` (if false, updatedb never adds newly discovered URLs).

### Inferences
- Nutch puts boost and politeness on separate axes. The float decides who goes first. `generate.max.count` per host or domain then caps how much one key can take per segment. For a Telegram directory, "host" maps to whatever shared rate-limit key exists. Probably no per-handle politeness applies (t.me is one host), so the caps would sit on a global daily budget plus per-source-class quotas rather than per host.
- `topN / numReducers` means each partition takes its own top slice. Global top-N holds only if scores spread evenly across partitions. A single-node Postgres `ORDER BY score DESC LIMIT n` has no such issue.
- The `_ngt_` generate-lock plus `crawl.gen.delay` is Nutch's answer to "selected but not yet fetched": it keeps a URL from being picked twice. A DB-backed frontier needs an equivalent claim column with a lease.

### Gaps
- I did not find an official benchmark or doc giving recommended `topN` / `generate.max.count` values for large crawls. Values in blog posts vary and are anecdotal.

---

## Q2. Nutch scoring plugins (OPIC, LinkRank, depth, similarity, orphan, metadata)

### Takeaway
OPIC, the default, is cash-flow importance. A page's score is the old score plus the sum of the cash its inlinks sent this cycle. It is sorted directly, so scores grow without bound and favour recrawled pages. Nutch's own wiki calls it broken for recrawls. Depth scoring is the simplest robust priority: sort value multiplied by `(1 + maxDepth − depth)`. LinkRank is offline PageRank over a WebGraph, written back as the score. Similarity scores outlinks by the parent page's cosine similarity to a gold-standard text. Orphan and metadata are lifecycle and metadata plumbing, not prioritisers.

### Cited Findings

**scoring-opic (`OPICScoringFilter`)** ([OPICScoringFilter.java](https://github.com/apache/nutch/blob/master/src/plugin/scoring-opic/src/java/org/apache/nutch/scoring/opic/OPICScoringFilter.java))
- `initialScore`: `datum.setScore(0.0f)`. A new link starts at 0 and gets cash only via `updateDbScore`.
- `generatorSortValue`: `return datum.getScore() * initSort`.
- `updateDbScore`: `datum.setScore(old.getScore() + Σ inlinked[i].getScore())`. History is never decayed.
- `distributeScoreToOutlinks`: `score = parent score / validCount`. With `db.score.count.filtered=true` it divides by `allCount` instead. Then `internalScore = score * db.score.link.internal` and `externalScore = score * db.score.link.external`, assigned by comparing host. Code comment: "XXX (ab) no adjustment? I think this is contrary to the algorithm descr. in the paper, where page 'loses' its score if it's distributed to linked pages..." In other words, the parent keeps its cash while also giving it away.
- `indexerScore = pow(dbScore, indexer.score.power[0.5]) * initScore`.
- Known flaws, from Ken Krugler's draft on the Nutch wiki: "You can't recrawl, at least not without having the recrawled pages get inflated scores", and the total score of the graph keeps increasing, so pages not recrawled lose share. The proposed Adaptive OPIC fix uses cash C and history H, score = C + H, a virtual root page receiving dangling cash, and time window T: if Δt ≥ T then H = C·(T/Δt), else H = C + H_prev·(T−Δt)/T. The page is marked a draft. [Fixing OPIC (Nutch wiki)](https://cwiki.apache.org/confluence/spaces/NUTCH/pages/115512062/FixingOpicScoring)
- NUTCH-572: OPIC score stays with a redirecting start URL rather than moving to the target. [NUTCH-572](https://issues.apache.org/jira/browse/NUTCH-572). Historical fixes: NUTCH-332 "Fix the problem of doubling scores caused by links pointing" (to the current page), NUTCH-1044 "Redirected URLs and possibly all of their outlinked URLs have invalid scores". [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)

**scoring-link / LinkRank** ([LinkRank.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/scoring/webgraph/LinkRank.java); [LinkAnalysisScoringFilter.java](https://github.com/apache/nutch/blob/master/src/plugin/scoring-link/src/java/org/apache/nutch/scoring/link/LinkAnalysisScoringFilter.java))
- Iterative formula: `linkRankScore = (1 − dampingFactor) + dampingFactor * totalInlinkScore`. `totalInlinkScore` starts at `rankOne = 1/numLinks`, so "a page with zero inlinks has a score of rankOne". Each node passes `outlinkScore` to its outlinks.
- Config: `link.analyze.num.iterations` = 10, `link.analyze.initial.score` = 1.0, `link.analyze.damping.factor` = 0.85, `link.ignore.internal.domain` = true, `link.ignore.limit.page` = true, `link.ignore.limit.domain` = true, `link.delete.gone` = false, `link.score.updater.clear.score` = 0.0 ("default score for URLs that are not in the web graph"). [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)
- The scoring filter only reads the stored score: `generatorSortValue = datum.getScore() * initSort`, `initialScore = 0.0`. Scores come from the separate WebGraph → LinkRank → ScoreUpdater jobs, which rebuild the graph each run. That rebuild is how it avoids OPIC's ever-growing totals. [search summary of Nutch docs](https://nutch.apache.org/documentation/javadoc/api/org/apache/nutch/scoring/opic/package-summary.html)

**scoring-depth (`DepthScoringFilter`)** ([DepthScoringFilter.java](https://github.com/apache/nutch/blob/master/src/plugin/scoring-depth/src/java/org/apache/nutch/scoring/depth/DepthScoringFilter.java))
- Metadata keys: `_depth_`, `_maxdepth_`. Seeds get depth 1. A per-seed max comes from injecting `_maxdepth_=VALUE`. `scoring.depth.max` defaults to 1000.
- `distributeScoreToOutlinks`: if `curDepth >= curMaxDepth`, clear all targets ("depth exceeded - throw away"). Otherwise stamp each outlink `_depth_ = curDepth + 1` and propagate `_maxdepth_`. If the parent has no depth, it drops all outlinks.
- `generatorSortValue`: `mul = curMaxDepth − curDepth; return initSort * (1 + mul)`. A record with no depth is penalised as `curDepth = curMaxDepth`, giving a multiplier of 1.
- `updateDbScore`: depth = min(old depth, every inlink's depth). A shorter path found later promotes the URL.
- `scoring.depth.override.pattern` + `scoring.depth.max.override`: a regex on the source URL that sets a different max depth for its outlinks (NUTCH-2993 lets a URL pattern skip the depth check). The property description says the depth "is used to prioritise URLs in the generation step so that shallower pages are fetched first." [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml); [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)

**scoring-similarity (cosine)** ([SimilarityScoringFilter.java](https://github.com/apache/nutch/blob/master/src/plugin/scoring-similarity/src/java/org/apache/nutch/scoring/similarity/SimilarityScoringFilter.java); [CosineSimilarity.java](https://github.com/apache/nutch/blob/master/src/plugin/scoring-similarity/src/java/org/apache/nutch/scoring/similarity/cosine/CosineSimilarity.java))
- `passScoreAfterParsing`: builds a DocVector from `parse.getText() + metatag.description + metatag.keyword`, n-grams per `scoring.similarity.ngrams` (default `1,1`), stopwords from `scoring.similarity.stopword.file`. Score = cosine similarity to the model built from `cosine.goldstandard.file`. On any error the score is 1.
- `distributeScoreToOutlinks`: every outlink gets the parent's similarity score (`target.setScore(score)`). Outlinks inherit topical relevance from the page they were found on. `scoring.similarity.model` = `cosine` is the only model. [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)

**scoring-orphan** ([OrphanScoringFilter.java](https://github.com/apache/nutch/blob/master/src/plugin/scoring-orphan/src/java/org/apache/nutch/scoring/orphan/OrphanScoringFilter.java))
- On each updatedb with inlinks it stamps `_orphan_ = now`. Without inlinks, once `now − _orphan_ > scoring.orphan.mark.orphan.after` (default 3,456,000 s = 40 days) the status becomes `STATUS_DB_ORPHAN`. Past `scoring.orphan.mark.gone.after` (default 2,592,000 s = 30 days) it becomes `STATUS_DB_GONE`. `db.update.purge.orphans` = false controls deletion. The `nutch-default.xml` description of `mark.orphan.after` wrongly says "marked as gone". [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)

**scoring-metadata** ([MetadataScoringFilter.java](https://github.com/apache/nutch/blob/master/src/plugin/scoring-metadata/src/java/org/apache/nutch/scoring/metadata/MetadataScoringFilter.java))
- Copies listed keys: `scoring.db.md` (CrawlDb → content), `scoring.content.md` (content → parse), `scoring.parse.md` (parse → each outlink's CrawlDatum metadata). It does not change scores, but it lets a custom filter or a `generate.expr` act on inherited metadata.

**Operator controls in Nutch**
- Seed-file metadata recognised by Injector: `nutch.score=<float>` sets the score, `nutch.fetchInterval=<secs>`, `nutch.fetchInterval.fixed=<secs>` (pins the interval via the `fixedInterval` metadata key, which AdaptiveFetchSchedule honours). Any other `key=value` goes into CrawlDatum metadata (e.g. `_maxdepth_`). [Injector.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Injector.java)
- `db.injector.overwrite` (false) replaces existing records. `db.injector.update` (false) merges, and the code "smoothly update[s] score and interval": `old.setScore((injected.getScore() + old.getScore()) / 2.0f)`. Re-injecting a boost halves its effect. [Injector.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Injector.java); [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)
- `generate.expr` (Jexl over CrawlDatum), `generate.restrict.status`, `generate.min.score`, URL filters (`generate.filter`) and normalisers are the remaining selection levers.

### Inferences
- For a reference-mined directory, OPIC's failure mode maps directly. A count of mentions that only ever accumulates, with no decay and no normalisation, will make long-known, heavily referenced handles permanently outrank fresh discoveries. Any reference-count score needs a decay or windowing (Adaptive OPIC's H formula is one template), or should be recomputed from scratch like LinkRank.
- The depth multiplier `(1 + max − depth)` gives a cheap breadth-first bias. "Hops from a seed or a followed channel" is a natural Telegram analogue, and `updateDbScore = min` handles a handle being rediscovered via a shorter path.
- Similarity-style inheritance (the outlink gets the parent's relevance) is a cheap way to prioritise handles found in relevant channels before fetching them at all.
- Nutch has no first-class "pin/boost" flag. Operators use injected score or metadata plus a custom filter. A UI-driven boost fits better as a separate multiplicative term that the generator sort applies, rather than an overwrite of the learned score. That way a recompute does not erase it, and re-injection does not average it away.

### Gaps
- I did not confirm whether any Nutch release implemented the full Adaptive OPIC from the wiki draft. The current plugin code shows it did not.

---

## Q3. Nutch fetch schedules: Default vs Adaptive vs MimeAdaptive, change detection, retries, gone pages

### Takeaway
Re-fetch is driven by `fetchTime` on each CrawlDatum, and `shouldFetch` is simply `fetchTime <= now`. DefaultFetchSchedule adds a fixed interval (30 days). AdaptiveFetchSchedule multiplies the interval by `(1 − dec_rate)` when the signature changed and `(1 + inc_rate)` when it did not, clamped to [min, max]. It can optionally pull the next fetch earlier toward the observed change time (`sync_delta`). Transient errors retry daily up to `db.fetch.retry.max` (3), then become GONE with the interval × 1.5. Nothing is ever permanently dropped: `db.fetch.interval.max` forces a re-check.

### Cited Findings

**Defaults** ([nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml))
- `db.fetch.interval.default` = 2,592,000 s (30 days). `db.fetch.interval.max` = 7,776,000 s (90 days): "After this period every page in the db will be re-tried, no matter what is its status." `db.fetch.schedule.class` = `org.apache.nutch.crawl.DefaultFetchSchedule`.
- `db.fetch.schedule.adaptive.inc_rate` = 0.4, `dec_rate` = 0.2 (both "should not exceed 0.5, otherwise the algorithm becomes unstable"), `min_interval` = 60.0 s, `max_interval` = 31,536,000.0 s (365 days, "limited by db.fetch.interval.max"), `sync_delta` = true, `sync_delta_rate` = 0.3. `db.fetch.schedule.mime.file` = `adaptive-mimetypes.txt`. `db.fetch.retry.max` = 3. `db.signature.class` = `org.apache.nutch.crawl.MD5Signature`. `db.update.purge.404` = false.
- Discrepancy: the Java fallback default for `inc_rate` in `AdaptiveFetchSchedule.setConf` and `MimeAdaptiveFetchSchedule` is `0.2f`, while `nutch-default.xml` ships `0.4`. The XML wins at runtime when loaded. [AdaptiveFetchSchedule.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/AdaptiveFetchSchedule.java)

**AbstractFetchSchedule** ([AbstractFetchSchedule.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/AbstractFetchSchedule.java))
- `initializeSchedule`: `fetchTime = now`, `fetchInterval = db.fetch.interval.default`, `retriesSinceFetch = 0`. New URLs are due immediately.
- `shouldFetch`: if `fetchTime − now > maxInterval`, clamp the interval to `0.9 * maxInterval` and set `fetchTime = now`. Then return `fetchTime <= curTime`.
- `setPageGoneSchedule`: "no page is truly GONE ... just increase the interval by 50%". Interval ×1.5, or `0.9 * maxInterval` if that would exceed max. Then `fetchTime = fetchTime + interval`.
- `setPageRetrySchedule`: `fetchTime += 1 day`, `retriesSinceFetch++`.
- `forceRefetch(asap)`: clamps the interval, sets status UNFETCHED, clears signature and modifiedTime, and optionally sets fetchTime to now.

**DefaultFetchSchedule**: `fetchTime = fetchTime + fetchInterval`, with the interval unchanged (0 is replaced by the default). [DefaultFetchSchedule.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/DefaultFetchSchedule.java)

**AdaptiveFetchSchedule.setFetchSchedule** ([AdaptiveFetchSchedule.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/AdaptiveFetchSchedule.java))
```
interval = (interval == 0) ? defaultInterval : interval          // NUTCH-1430
if datum has metadata "fixedInterval": interval = that           // NUTCH-1388
else:
  MODIFIED:     interval *= (1 - DEC_RATE); modifiedTime = fetchTime
  NOTMODIFIED:  interval *= (1 + INC_RATE)
  UNKNOWN:      unchanged
  min/max = per-host override (adaptive-host-specific-intervals.txt) else MIN/MAX_INTERVAL
  if SYNC_DELTA:
     delta = fetchTime - modifiedTime
     if delta > interval: interval = delta
     offset = round(delta * SYNC_DELTA_RATE)
     if delta > 0 and offset > maxInterval: offset = offset / delta * maxInterval   // NUTCH-1564
     refTime = fetchTime - offset
  clamp interval to [min, max]
fetchTime_next = refTime + interval
```
- Per-host min/max overrides come from `adaptive-host-specific-intervals.txt` (`getCustomMinInterval` / `getCustomMaxInterval`). NUTCH-1564 ("sync_delta forces immediate refetch for documents not modified") was fixed in the 1.22 release notes. [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)
- MimeAdaptiveFetchSchedule overrides `INC_RATE` / `DEC_RATE` per content type from `adaptive-mimetypes.txt` and otherwise behaves like Adaptive. NUTCH-1967 fixed a "Possible SIooBE in MimeAdaptiveFetchSchedule". [MimeAdaptiveFetchSchedule.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/MimeAdaptiveFetchSchedule.java)

**How "modified" is decided (CrawlDbReducer)** ([CrawlDbReducer.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/CrawlDbReducer.java))
- `STATUS_FETCH_NOTMODIFIED` (HTTP 304) → NOTMODIFIED. `STATUS_FETCH_SUCCESS` with both old and new signatures → `SignatureComparator._compare(old, new) != 0` ? MODIFIED : NOTMODIFIED. Redirects are never compared ("only successful fetches (but not redirects, NUTCH-1422)"). A missing signature means UNKNOWN, so the interval is unchanged.
- On NOTMODIFIED: status becomes `STATUS_DB_NOTMODIFIED`, `modifiedTime` is reset to the previous value, and the old signature is kept (NUTCH-1341).
- After scheduling, `if (db.fetch.interval.max < result.getFetchInterval()) forceRefetch(...)`, which prevents pages from getting "stuck at NOTMODIFIED state".
- `STATUS_FETCH_RETRY`: `setPageRetrySchedule` (+1 day). If `retriesSinceFetch < db.fetch.retry.max` the status is UNFETCHED, otherwise `STATUS_DB_GONE` + `setPageGoneSchedule`. `STATUS_FETCH_GONE` and `STATUS_PARSE_FAILED` go straight to the gone schedule.
- `STATUS_LINKED` for a new URL: `initializeSchedule` + `scfilters.initialScore`. For a known URL the old record is kept unchanged. Rediscovery does not reschedule.

### Inferences
- For Telegram the natural signature is "latest post id / last post date". A newer post means MODIFIED, the same post means NOTMODIFIED. Adaptive multiplicative intervals with clamps (e.g. min 1 day, max 90 days) map directly. The `sync_delta` idea (pull the next fetch toward the last change) is weaker there, because Telegram gives exact post timestamps. You can estimate a posting rate directly instead of inferring it from changed/unchanged bits.
- The dec_rate/inc_rate ≤ 0.5 stability warning matters. With dec 0.2 and inc 0.4 a page alternating changed/unchanged drifts upward (0.8 × 1.4 = 1.12 per pair), so intervals lengthen for pages that change about half the time.
- The "retry daily ×3, then GONE with ×1.5 backoff capped at 0.9 × max" pattern is a ready-made dead-handle policy. It never deletes and keeps re-checking with a bounded interval, which suits handles that get freed and re-registered.

### Gaps
- I found no published empirical evaluation of Nutch's adaptive rates on real crawls. The stability claim is only the config doc's assertion.

---

## Q4. Nutch HostDB, per-host limits and `generate.restrict.status`

### Takeaway
Politeness in Nutch is split. Selection-time caps (`generate.max.count` per host/domain, optionally a Jexl function of HostDB stats) bound how many URLs a host gets per segment. Fetch-time queues (`fetcher.queue.mode` byHost/byDomain/byIP with crawl delays) enforce the rate. HostDB is an aggregated per-host table (fetched, unfetched, gone, notModified, DNS failures and so on) that the Generator can feed into those caps. `generate.restrict.status` restricts a whole generate run to one CrawlDb status, e.g. only `db_unfetched`.

### Cited Findings
- `generate.restrict.status`: "Select only entries of this status, see NUTCH-1248". The mapper check is `if (restrictStatus != -1 && restrictStatus != crawlDatum.getStatus()) skip`. NUTCH-2738 documented it. [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml); [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java); [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)
- HostDB properties: `hostdb.recheck.interval` = 86,400,000 ms (the description says "one week", which contradicts the value of 1 day), multiplied by the number of DNS failures; `hostdb.purge.failed.hosts.threshold` = 3; `hostdb.num.resolvers.threads` = 25; `hostdb.check.failed/new/known` = true; `hostdb.numeric.fields` = `_rs_` (response time); `hostdb.string.fields` = `Content-Type`; `hostdb.percentiles` = `50,75,95,99`; `hostdb.crawldatum.processors` for custom aggregators (`org.apache.nutch.hostdb.CrawlDatumProcessor`). [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)
- Jexl variables available to `generate.max.count.expr`: `dnsFailures, connectionFailures, unfetched, fetched, notModified, redirTemp, redirPerm, gone`, plus HostDB metadata. [Generator.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Generator.java)
- `fetcher.queue.mode` = `byHost` ("Crawl delays are implemented on the level of fetcher queues"); `fetcher.queue.depth.multiplier` = 50. [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)
- Throughput ceiling from per-key politeness, from the StormCrawler FAQ as surfaced by search: 1M URLs on one host at a 1 s delay caps throughput at 86,400 pages/day. [StormCrawler FAQ (search snippet; direct fetch returned 404)](https://stormcrawler.apache.org/faq)

### Inferences
- The HostDB-as-feature-table pattern transfers well. A per-source aggregate (e.g. per-referrer-channel: how many of its references resolved to live channels vs dead or invalid) could drive a Jexl-like quota, giving more discovery budget to sources whose references pay off.
- A `restrict.status`-style mode ("this run: only unfetched", "this run: only refresh") is a simple way to split a shared 80k/day budget between discovery and refresh. Run separate selections with separate quotas instead of mixing everything into one score.

### Gaps
- I did not verify the HostDB `hostdb.recheck.interval` description/value mismatch against JIRA. It is just what the shipped XML says.

---

## Q5. StormCrawler schedulers (Default, Adaptive), intervals, errors, custom intervals

### Takeaway
StormCrawler has no score. Every status update calls `Scheduler.schedule(status, metadata)`, which returns a `nextFetchDate` (or empty, meaning never). The status backend stores it, and spouts pull URLs with `nextFetchDate <= now`. DISCOVERED URLs get `now`. FETCHED and REDIRECTION get `fetchInterval.default` (1440 min). FETCH_ERROR gets 120 min, and after `max.fetch.errors` (3) consecutive errors the status becomes ERROR (default -1, never). Per-URL overrides come from metadata: an explicit `scheduler.delay.mins`, or config rules `fetchInterval[.STATUS].<mdkey>=<mdvalue>: minutes`. AdaptiveScheduler grows or shrinks a persisted `fetchInterval` metadata field by signature comparison.

### Cited Findings

**Defaults (`core/src/main/resources/crawler-default.yaml`)** ([crawler-default.yaml](https://github.com/apache/stormcrawler/blob/main/core/src/main/resources/crawler-default.yaml))
- `scheduler.class: "org.apache.stormcrawler.persistence.DefaultScheduler"`; `fetchInterval.default: 1440` ("revisit a page daily (value in minutes); set it to -1 to never refetch a page"); `fetchInterval.fetch.error: 120`; `fetchInterval.error: -1` ("never revisit a page with an error"); commented examples `fetchInterval.FETCH_ERROR.isFeed=true` and `fetchInterval.isFeed=true: 10`; `max.fetch.errors: 3`; `status.updater.use.cache: true`; `status.updater.cache.spec: "expireAfterAccess=1h,softValues"`; `status.updater.unit.round.date: "SECOND"`; `status.updater.normalise.hosts: false`.
- Discrepancy: `DefaultScheduler.init` falls back to `44640` minutes (31 days) for `fetchInterval.error` if the key is absent, while the YAML ships `-1`. [DefaultScheduler.java](https://github.com/apache/stormcrawler/blob/main/core/src/main/java/org/apache/stormcrawler/persistence/DefaultScheduler.java)

**DefaultScheduler.schedule** ([DefaultScheduler.java](https://github.com/apache/stormcrawler/blob/main/core/src/main/java/org/apache/stormcrawler/persistence/DefaultScheduler.java))
- Precedence: (1) metadata `scheduler.delay.mins` (`DELAY_METADATA`), (2) a custom rule matching regex `^fetchInterval(\..+?)?\.(.+)=(.+)`, e.g. `fetchInterval.isFeed=true` or `fetchInterval.FETCH_ERROR.isFeed=true`, with a per-status value or a default, (3) the status switch: FETCHED and REDIRECTION use the default, FETCH_ERROR uses fetch.error, ERROR uses error, and DISCOVERED and others add 0 minutes (now). `-1` returns `Optional.empty()`, meaning never refetch. Next date = now(GMT) + minutes.
- The configuration docs give an example of the custom-interval pattern for a different metadata key: `fetchInterval.fetch.with=playwright: 5`. [configuration.html](https://github.com/apache/stormcrawler-site/blob/main/docs/latest/configuration.html)

**AbstractStatusUpdaterBolt** ([AbstractStatusUpdaterBolt.java](https://github.com/apache/stormcrawler/blob/main/core/src/main/java/org/apache/stormcrawler/persistence/AbstractStatusUpdaterBolt.java))
- DISCOVERED URLs pass through a Caffeine cache. If the URL is already in the cache it is not re-stored ("internal cache of URLs with a discovered status so that they don't get added to the backend if they already exist"). Backends also typically insert DISCOVERED as create-only. [internals.adoc](https://github.com/apache/stormcrawler/blob/main/docs/src/main/asciidoc/internals.adoc)
- A preset `nextFetchDate` can be passed in metadata and is used as-is (the key is defined in the bolt, "Key used to pass a preset Date to use as nextFetchDate").
- FETCH_ERROR counting: it increments metadata `fetch.error.count` (`Constants.fetchErrorCountParamName`). When `count >= max.fetch.errors` the status becomes ERROR with `error.cause = maxFetchErrors`. The count is removed on any other status. ERROR emits to the deletion stream. It stores `discoveryDate` or `lastProcessedDate`. Then `scheduler.schedule(status, metadata)` runs before metadata filtering, "so that non-persisted metadata is available to fetch schedulers".

**AdaptiveScheduler** ([AdaptiveScheduler.java](https://github.com/apache/stormcrawler/blob/main/core/src/main/java/org/apache/stormcrawler/persistence/AdaptiveScheduler.java); [internals.adoc](https://github.com/apache/stormcrawler/blob/main/docs/src/main/asciidoc/internals.adoc))
- Config keys and code defaults: `scheduler.adaptive.fetchInterval.min` = 60 min, `scheduler.adaptive.fetchInterval.max` = 20160 min (14 days), `scheduler.adaptive.fetchInterval.rate.incr` = 0.5, `scheduler.adaptive.fetchInterval.rate.decr` = 0.5, `scheduler.adaptive.setLastModified` = false.
- Required persisted metadata: `signature` (from `MD5SignatureParseFilter`), `fetch.statusCode`, `fetchInterval`, `signatureChangeDate`, `last-modified`, `protocol.etag`. The docs list these under `metadata.persist`, an issue later added to the docs (#2001). [issue #2001](https://github.com/apache/stormcrawler/issues/2001)
- Logic: if status != FETCHED, it clears `signatureChangeDate`, `fetchInterval`, `signature` and `signatureOld` (and `last-modified` on ERROR) and falls back to DefaultScheduler. On 304 it does no comparison and treats the fetch as unchanged. With no signature or old signature it falls back to Default and records the resulting interval in `fetchInterval`. With signatures equal → unchanged. Different → changed, and `signatureChangeDate = now`.
- Changed: `interval = (1 − decr) * interval + decr * minInterval`. This is an exponential approach to the min ("slow down decrementing if already close to the minimum interval"), not a plain multiply.
- Unchanged: `interval = interval * (1 + incr)`, capped at max.
- The initial interval comes from a custom-interval rule if one matches, else `fetchInterval.default`.
- HTTP 304 handling came from PR #419 ("Adaptive schedule HTTP 304 ignore persisted signatures"). Last-modified support came from PR #812 / issue #777. [PR #419](https://github.com/apache/stormcrawler/pull/419); [PR #812](https://github.com/apache/stormcrawler/pull/812)

### Inferences
- StormCrawler's design maps closely onto a Postgres directory. Each row has `status`, `next_fetch_date` and a metadata bag. The scheduler is a pure function `(status, metadata) → next date`, and the spout is `WHERE next_fetch_date <= now ORDER BY ... LIMIT`. Operator boosts fit the `scheduler.delay.mins` / preset-`nextFetchDate` escape hatches. Pulling `nextFetchDate` earlier is the only priority lever the model has.
- The `(1−d)·I + d·min` decrement is worth copying. It makes "changed" shrink geometrically toward the floor without overshooting, and incr 0.5 / decr 0.5 is far more aggressive than Nutch's 0.4/0.2.
- With no score, StormCrawler orders discovery purely by time. Every newly discovered URL gets `nextFetchDate = now` and competes equally with overdue refreshes. Prioritising discovered entries requires a different sort field (see Q6) or writing a future or past `nextFetchDate` at discovery time.

### Gaps
- I did not find documentation of how DISCOVERED URLs found again with new metadata (e.g. a higher-priority source) update an existing record. The cache plus create-only insert suggests they do not.

---

## Q6. StormCrawler spouts and status backends: buckets, sorting, sampling, priority as a sort

### Takeaway
The OpenSearch `AggregationSpout` runs one query: `nextFetchDate <= queryDate`, plus optional filter queries. It runs a `terms` aggregation on the bucket field (`key` = host by default), up to `opensearch.status.max.buckets` (50) buckets. Inside each bucket a `top_hits` returns `opensearch.status.max.urls.per.bucket` (2) docs sorted ascending by `opensearch.status.bucket.sort.field` (`nextFetchDate`, `url`). Buckets are ordered by min(`opensearch.status.global.sort.field`) (`nextFetchDate`). Priority equals sort order, and any status-index field can serve as the sort key. The SQL spout uses `rank() OVER (PARTITION BY host ...)` for the same per-host fairness. The URL buffer then decides the order across queues.

### Cited Findings

**OpenSearch config (`external/opensearch/opensearch-conf.yaml`)** ([opensearch-conf.yaml](https://github.com/apache/stormcrawler/blob/main/external/opensearch/opensearch-conf.yaml))
- `opensearch.status.index.name: "status"`; `opensearch.status.routing: true`; `opensearch.status.routing.fieldname: "key"`; `opensearch.status.max.buckets: 50`; `opensearch.status.max.urls.per.bucket: 2`; `opensearch.status.bucket.field: "key"`; `opensearch.status.bucket.sort.field: ["nextFetchDate", "url"]`; `opensearch.status.global.sort.field: "nextFetchDate"`; `opensearch.status.sample: false` ("sampling improves the performance on large crawls"); `opensearch.status.query.timeout: -1`; `opensearch.status.recentDate.increase: -1`; `opensearch.status.recentDate.min.gap: -1`; `opensearch.status.filterQuery` (Lucene query strings, e.g. `-(key:stormcrawler.net)`); `spout.ttl.purgatory: 30` (seconds a URL is not re-emitted after ack/fail); `spout.min.delay.queries: 2000` ms; `spout.max.delay.queries: 20000` ms; `spout.reset.fetchdate.after: 120` s.
- Older StormCrawler (≤2.x, `com.digitalpebble.stormcrawler`) used the `es.status.*` prefix for the same keys (e.g. `es.status.max.urls.per.bucket`, `es.status.bucket.sort.field`). Issue #230, "Custom priority", asked for a configurable sort field such as `es.status.custom.sort: "priority"`. Julien Nioche replied: "Added es.status.sort.field ... AggregationSpout could already sort within a bucket with es.status.bucket.sort.field". [issue #230](https://github.com/apache/stormcrawler/issues/230)
- The Elasticsearch module was removed (PR #1182, 2024-04-02, fixing #1167 over licensing). Issue #1339 asked to reinstate it once Elasticsearch was open source again (closed 2024-10-02). The OpenSearch module "is ported from the Elasticsearch one". [PR #1182](https://github.com/apache/stormcrawler/pull/1182); [issue #1339](https://github.com/apache/stormcrawler/issues/1339); [opensearch README](https://github.com/apache/stormcrawler/blob/main/external/opensearch/README.md)
- `CollapsingSpout` (ES field-collapsing spout, e.g. issue #635 "CollapsingSpout replace paging with Search After", 2018) does not exist in the current OpenSearch module. Only `AggregationSpout` and `HybridSpout` remain, and HybridSpout's javadoc still says "Uses collapsing spouts". [issue #635](https://github.com/apache/stormcrawler/issues/635); [HybridSpout.java](https://github.com/apache/stormcrawler/blob/main/external/opensearch/src/main/java/org/apache/stormcrawler/opensearch/persistence/HybridSpout.java)

**AggregationSpout.populateBuffer** ([AggregationSpout.java](https://github.com/apache/stormcrawler/blob/main/external/opensearch/src/main/java/org/apache/stormcrawler/opensearch/persistence/AggregationSpout.java))
- Query: `bool.filter(range nextFetchDate lte queryDate)` + each filterQuery. `size(0)`, `trackTotalHits(false)`.
- `terms("partition").field(bucketField).size(maxBuckets)` → sub-agg `topHits("docs").size(maxURLsPerBucket)` sorted ASC by each `bucket.sort.field`. If `global.sort.field` is set, it adds sub-agg `min("top_hit")` on that field and orders buckets by it ascending.
- With `sample=true`, a `DiversifiedAggregationBuilder("sample").field(bucketField).maxDocsPerValue(maxURLsPerBucket).shardSize(maxURLsPerBucket * maxBuckets)` wraps the terms agg. The query then looks at a per-shard sample instead of all due docs.
- URLs already in `beingProcessed` (in flight or in purgatory) are skipped and counted as `already_being_processed`.
- `queryDate` logic: on first query, `queryDate = now`. With `recentDate.increase >= 0`, `queryDate = mostRecentDateFound + increase` (bounded by `recentDate.min.gap`). After `spout.reset.fetchdate.after` seconds since the last reset, or if a query returned 0 buckets, `queryDate = null`, meaning reset to now on the next query. Between resets the spout keeps querying with a stale `queryDate`, so URLs that became due in the meantime are invisible for up to 120 s. The code comment in the YAML says "Setting this to -1 or a large value means that OpenSearch will cache the results but also that fewer and fewer results might be returned." The published configuration page describes this key differently ("Reset a URL's fetch date if it has not been acked within this many seconds"), and that description does not match the code. [configuration.html](https://github.com/apache/stormcrawler-site/blob/main/docs/latest/configuration.html)
- Javadoc: "Use a single instance unless you use 'opensearch.status.routing' with the StatusUpdaterBolt, in which case you need to have exactly the same number of spout instances as OpenSearch shards. Guarantees a good mix of URLs by aggregating them by an arbitrary field e.g. key."

**SQL spout** ([SQLSpout.java](https://github.com/apache/stormcrawler/blob/main/external/sql/src/main/java/org/apache/stormcrawler/sql/SQLSpout.java))
```sql
SELECT * FROM (
  SELECT rank() OVER (PARTITION BY host ORDER BY nextfetchdate DESC, url) AS ranking,
         url, metadata, nextfetchdate
  FROM urls WHERE nextfetchdate <= ? [AND bucket = ?]
) AS urls_ranks
WHERE urls_ranks.ranking <= ?          -- sql.max.urls.per.bucket (default 5)
ORDER BY ranking [LIMIT sql.spout.max.results (default 100)]
```
- With several spout instances, each takes `bucket = taskIndex`, a precomputed partition column. Within a host it orders `nextfetchdate DESC`, so the most recently due URL comes first, the opposite of the OpenSearch spout's ASC. Overdue URLs on a busy host can starve. Config docs: `sql.max.urls.per.bucket` 5, `sql.spout.max.results` 100; Solr: `solr.status.bucket.field` host, `solr.status.bucket.maxsize` 5, `solr.status.max.results` 10. [configuration.html](https://github.com/apache/stormcrawler-site/blob/main/docs/latest/configuration.html)

**URL buffers (`urlbuffer.class`)** ([urlbuffer package](https://github.com/apache/stormcrawler/tree/main/core/src/main/java/org/apache/stormcrawler/persistence/urlbuffer))
- `SimpleURLBuffer` (default): "rotates on the queues without applying any priority". `PriorityURLBuffer` (since 1.16): every 10 s it re-ranks queues by acks received in the window and puts the most-acked queues first, so it favours fast-moving queues. `SchedulingURLBuffer`: "Checks how long the last N URLs took to work out whether a queue should release a URL" (`priority.buffer.max.time.msec`). The `URLBuffer` interface "Guarantees that no URL can be put in the buffer more than once."

### Inferences
- The aggregation-with-top-hits pattern (N buckets × K per bucket, buckets ordered by min due date) is a fair-share selection. In SQL it is `row_number() OVER (PARTITION BY bucket ORDER BY priority DESC, next_fetch_date)` + `WHERE rn <= K` + an outer `ORDER BY`. For Telegram the bucket could be a source class (discovery vs refresh vs operator-boosted) or the referring channel, so one prolific referrer cannot flood the frontier.
- Expressing priority as a sort makes a UI boost trivial (write a `priority` column, sort `priority DESC, next_fetch_date ASC`). Mixing a numeric score with dates needs care, though. A boolean or bucketed priority tier with date as the tie-break is simpler than a blended float.
- The stale-`queryDate` caching trick only matters for OpenSearch request caching. A Postgres frontier should use `now()` each time.

### Gaps
- I could not retrieve the StormCrawler FAQ page directly (404 via fetch). The 86,400/day figure comes from the search-engine snippet only.
- I found no DigitalPebble blog post with production values for `max.buckets` / `urls.per.bucket` beyond the shipped defaults.

---

## Q7. URLFrontier: the gRPC API, ordering within a queue, priority support

### Takeaway
URLFrontier (crawler-commons/url-frontier) has no priority field. A queue is identified by `key` (host by default) within a `crawlID`. Inside a queue, URLs are ordered by their scheduling date: `refetchable_from_date` for known URLs and insertion time for discovered ones, ties broken by URL string. In practice that is "FIFO per queue". Across queues the server rotates and enforces a per-queue delay, a block-until and a crawl limit. The client's only levers are `refetchable_from_date`, queue keys, `SetDelay`, `BlockQueueUntil`, `SetCrawlLimit` and `GetURLs` parameters.

### Cited Findings

**API (`API/src/main/protobuf/urlfrontier.proto`)** ([urlfrontier.proto](https://github.com/crawler-commons/url-frontier/blob/master/API/src/main/protobuf/urlfrontier.proto))
- RPCs: `ListNodes, ListCrawls, DeleteCrawl, ListQueues, GetURLs (stream URLInfo), PutURLs (stream URLItem ↔ stream AckMessage), PutDiscovered (stream DiscoveredBatch ↔ BatchAck), GetStats, DeleteQueue, BlockQueueUntil, SetActive, GetActive, SetDelay, SetLogLevel, SetCrawlLimit, GetURLStatus, ListURLs, CountURLs, PurgeURLs`.
- `GetParams`: `max_urls_per_queue` (0 = no limit), `max_queues` (0 = no limit), `key` (restrict to one queue), `delay_requestable` ("delay in seconds before a URL can be unlocked and sent again for fetching ... the default value of 0 ... lets the service pick a value - 30 seconds in the reference implementation"), `crawlID` or `anyCrawlID`.
- `URLInfo`: `url`, `key` ("typically the hostname, domain name or IP or the URL. If not set, the service will use a sensible default like hostname"), `metadata` (map<string, StringList>), `crawlID`.
- `KnownURLItem.refetchable_from_date`: seconds since epoch; "the default value of 0 indicates that a URL should not be refetched". `DiscoveredURLItem`: "might already be known ... or not". PutURLs answers with SKIPPED if it is already known.
- `QueueDelayParams.delay_requestable`: "No URLs will be obtained via GetURLs for this queue until the number of seconds specified has elapsed since the last time URLs were retrieved. Usually informed by the delay setting of robots.txt." An empty key sets the default for all queues.
- `BlockQueueUntil`: "useful for cases where a server returns a Retry-After". `SetCrawlLimit(key, limit)`: per-queue cap on completed URLs. `PurgeURLs`: deletes URLs older than N days by `creation_date`.

**Reference implementation ordering** ([RocksDBService.java](https://github.com/crawler-commons/url-frontier/blob/master/service/src/main/java/crawlercommons/urlfrontier/service/rocksdb/RocksDBService.java); [InternalURL.java](https://github.com/crawler-commons/url-frontier/blob/master/service/src/main/java/crawlercommons/urlfrontier/service/memory/InternalURL.java); [AbstractFrontierService.java](https://github.com/crawler-commons/url-frontier/blob/master/service/src/main/java/crawlercommons/urlfrontier/service/AbstractFrontierService.java))
- RocksDB scheduling key: `queueKey + "_" + paddedDate(nextFetchDate) + "_" + url`. Iteration seeks the queue prefix and stops at the first `scheduled > now` ("they are sorted by date no need to go further"). It skips URLs held in flight (`holdUntil(now + delay_requestable)`).
- Memory implementation: `InternalURL.compareTo` sorts by `nextFetchDate`, then `url`. Discovered URLs get `nextFetchDate = now` at insert, known URLs get `refetchable_from_date`.
- `tryReserveQueue` refuses a queue if it is blocked (`getBlockedUntil() >= now`), at its crawl limit, inside its delay window (`lastProduced + delay >= now`), or at `inProcess >= maxURLsPerQueue`.
- StormCrawler issue #2185 (closed 2026-10-01) states the consequence: "With URLFrontier the order of the crawl is decided entirely by the frontier: it rotates between queues (one per host) and serves each queue FIFO. The depth of a URL plays no role ... `GetURLs` gives no way to ask for shallow URLs either". It proposes depth metrics first and leaves steering (adaptive `max.buckets` / `urls.per.bucket`, or explicit queue selection by `key`) for later. [issue #2185](https://github.com/apache/stormcrawler/issues/2185)
- A GitHub issue search for "priority" in crawler-commons/url-frontier found no priority feature request or design. [GitHub search](https://github.com/crawler-commons/url-frontier/issues?q=priority)
- StormCrawler's URLFrontier spout config: `urlfrontier.max.buckets` 10, `urlfrontier.max.urls.per.bucket` 10 (must be 1 with robots crawl-delay pacing). PR #1973 added "Block the URLFrontier queue on Retry-After via the queue stream". [configuration.html](https://github.com/apache/stormcrawler-site/blob/main/docs/latest/configuration.html); [PR #1973](https://github.com/apache/stormcrawler/pull/1973)

### Inferences
- The only way to express priority in URLFrontier is to encode it in time or in queue choice: give boosted URLs an earlier `refetchable_from_date`, or put them in a dedicated queue key that the client polls with `GetParams.key`. A "priority lane" in a homegrown frontier is the same trick.
- `BlockQueueUntil` on Retry-After maps directly onto Telegram FLOOD_WAIT / 429 handling. It is a per-key "not before" timestamp, separate from per-URL schedules.
- `SetCrawlLimit` per key is a budget cap. Applied per source class it would bound how much of the 80k/day goes to discovery.

### Gaps
- The proto has no explicit statement that ordering within a queue is by date. I inferred it from the reference implementations and from issue #2185's "FIFO".

---

## Q8. Operator-facing controls for tuning priority, and pitfalls users report

### Takeaway
None of the three projects has a UI-level "boost this entry" primitive. Nutch operators re-inject with `nutch.score` / `nutch.fetchInterval[.fixed]` metadata (with `db.injector.update` averaging scores), use `generate.expr` / `restrict.status` / `min.score`, URL filters, depth overrides, and per-host interval files. StormCrawler operators set per-URL `scheduler.delay.mins`, a preset nextFetchDate, metadata-keyed `fetchInterval.*` rules, sort fields and filter queries. URLFrontier operators control dates, queue keys, delays, blocks and limits. The pitfalls cluster around unbounded score growth, defaults that disagree between code and config, and selection queries that see stale or partial data.

### Cited Findings
- Nutch seed metadata: `nutch.score`, `nutch.fetchInterval`, `nutch.fetchInterval.fixed`, `_maxdepth_`. `db.injector.update` merges via `(injected + old) / 2`. [Injector.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/Injector.java)
- Nutch per-host interval file: `adaptive-host-specific-intervals.txt` (host → min/max). [AdaptiveFetchSchedule.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/AdaptiveFetchSchedule.java)
- Nutch `scoring.depth.override.pattern` / `scoring.depth.max.override`: a regex-based crawl-depth boost for matching sources. [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)
- StormCrawler custom interval rules `fetchInterval[.STATUS].key=value: minutes`, and per-URL `scheduler.delay.mins`. [DefaultScheduler.java](https://github.com/apache/stormcrawler/blob/main/core/src/main/java/org/apache/stormcrawler/persistence/DefaultScheduler.java)
- StormCrawler `opensearch.status.filterQuery` (e.g. exclude a host) and configurable sort fields. [opensearch-conf.yaml](https://github.com/apache/stormcrawler/blob/main/external/opensearch/opensearch-conf.yaml); [issue #230](https://github.com/apache/stormcrawler/issues/230)
- Pitfall, OPIC: score inflation on recrawl and a growing system total. [Fixing OPIC](https://cwiki.apache.org/confluence/spaces/NUTCH/pages/115512062/FixingOpicScoring)
- Pitfall, Nutch generate without updatedb: identical fetchlists unless `generate.update.crawldb=true`. A generated-but-never-updated record stays locked for `crawl.gen.delay` (7 days). [nutch-default.xml](https://github.com/apache/nutch/blob/master/conf/nutch-default.xml)
- Pitfall, Nutch sync_delta: NUTCH-1564, "sync_delta forces immediate refetch for documents not modified" (fixed in 1.22). Earlier, NUTCH-652, "AdaptiveFetchSchedule#setFetchSchedule doesn't calculate fetch interval correctly". [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)
- Pitfall, per-host caps: NUTCH-1155 (limit was max.count+1), NUTCH-2574 (wrong comparison), NUTCH-1074 (topN ignored with maxNumSegments + max.count), NUTCH-2924 (maxCount expr evaluated only once). [CHANGES.md](https://github.com/apache/nutch/blob/master/CHANGES.md)
- Pitfall, defaults disagree between code and config: Nutch `inc_rate` (0.2 in code vs 0.4 in XML); StormCrawler `fetchInterval.error` (44640 in code vs -1 in YAML). Behaviour silently changes if the default config file is not on the classpath. [AdaptiveFetchSchedule.java](https://github.com/apache/nutch/blob/master/src/java/org/apache/nutch/crawl/AdaptiveFetchSchedule.java); [DefaultScheduler.java](https://github.com/apache/stormcrawler/blob/main/core/src/main/java/org/apache/stormcrawler/persistence/DefaultScheduler.java)
- Pitfall, StormCrawler URLs without a valid host (and routing) "stay DISCOVERED forever". [issue #706](https://github.com/apache/stormcrawler/issues/706)
- Pitfall, URLFrontier FIFO per host lets a crawl "sink into the deep pages of a few large hosts ... without anything in the topology showing it". [issue #2185](https://github.com/apache/stormcrawler/issues/2185)

### Inferences
- For the operator UI, I'd follow StormCrawler and URLFrontier: a boost moves `next_fetch_date` (now, or earlier) and/or sets a `priority` tier column sorted first. A deprioritise pushes `next_fetch_date` out or sets a fixed long interval (Nutch's `fixedInterval`). Each should be a separate persisted field the adaptive logic does not overwrite. That is exactly why Nutch added `fixedInterval` (NUTCH-1388) on top of the adaptive schedule.
- All three systems keep discovery and refresh in the same table and the same ordering. Only Nutch has a mode switch (`restrict.status`). Given ~1M discovered vs ~500k live entries competing for 80k/day, an explicit per-class budget (bucket quotas, as in AggregationSpout's N×K, or URLFrontier's per-key crawl limit) is the transferable idea. A single blended score lets one class starve the other.
- Adding a metric for "share of fetches by class/depth" before tuning (issue #2185's approach) is cheap and catches drift that ordering rules hide.

### Gaps
- I found no mailing-list threads with quantified production tuning of these knobs. Most "pitfalls" evidence here is JIRA/GitHub issue titles and code comments, not user reports with numbers.
