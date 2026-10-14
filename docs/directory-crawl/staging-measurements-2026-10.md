# Directory crawl on staging, 2026-10-14 and 15

Read-only psql on staging (`default_transaction_read_only = on`, parallel
workers off because the db container's 64 MB `/dev/shm` overflows on parallel
hash joins). The crawl had been recursive since DDS-02 (2026-09-23). These are
point-in-time numbers. Re-run the queries at the end before trusting any of
them.

## Size and status

| Measure | Value |
|---|---|
| Directory rows | 973k |
| `ok` / `channel` | 507,056 |
| `unavailable` (all kinds) | 464,688 |
| pending (`unknown`) | 1,498, all at `HARVEST_PRIORITY` |
| Frontier (Reference targets with no Directory row) | 654 |
| References | 5.3M |
| Followed Channels | 348 |

The Directory was about 64.5k rows before DDS-02. New rows per day ran 48-55k
in the first days, then settled around 24-30k (2026-10-04 to 10-14).

The frontier was nearly empty, so finding handles was no longer the
bottleneck. Probing them and refreshing what was already found was.

## Probe traffic and refresh

| Measure | Value |
|---|---|
| Rows probed in the last 24 h (`checked_at`) | 81,690 |
| ...of which refreshes of rows older than a day | 53,497 |
| Probe Requests/day (`tg_directory_probe_usage`), 10-05 → 10-13 | 48.5k → 79.7k, rising |
| Refreshes overdue (`refresh_due_at <= now()`) | 122,986, oldest from 2026-09-23 |
| Refreshes falling due per day over the next week | 49k-66k |

Refreshing 507k live rows every 7 days needs about 72k probes a day, which is
the whole probe lane. Because `HARVEST_PRIORITY` beats `REFRESH_PRIORITY`,
refresh only gets what discovery leaves.

Since DDS-02 the average sync fetch (`tg_network_logs.duration`) went from
about 0.9 s to 23-28 s, with no 429s. Probes are about 90% of the traffic on
the shared proxies.

## What the crawl found

| Measure | Value |
|---|---|
| `ok` channels with under 100 subscribers | 255,459 |
| under 1k / under 10k / 10k+ | 156,733 / 68,622 / 23,064 |
| `ok` channels cited by exactly one channel | 247,226 |
| idle over 90 days / over 365 days | 82,498 / 32,225 |
| posting less than once a week | 99,320 |

Languages of live channels: ru 324k (64%), en 58k, unlabelled 40k, fa 32k, zh
14k, uk 11k. The follows are fa 217, en 23 and unlabelled 103. The crawl
followed the densest part of the graph, not the deployment's readers.

## Signals known before a probe

These are live-channel rates for already-probed targets, grouped by
information that existed before the fetch. They are the inputs for a discovery
score.

| Best reference kind a target ever got | Live | Dead | Live rate |
|---|---|---|---|
| forward | 235,573 | 42,631 | 85% |
| reply | 7,829 | 1,828 | 81% |
| link | 157,442 | 110,239 | 59% |
| mention only | 107,456 | 310,531 | 26% |

| Distinct citing channels | Live | Dead | Live rate |
|---|---|---|---|
| 1 | 247,538 | 322,525 | 43% |
| 2-4 | 157,293 | 105,808 | 60% |
| 5-19 | 83,736 | 31,457 | 73% |
| 20+ | 19,795 | 5,441 | 78% |

Handles ending in `bot`: 65,209 dead, 227 live (99.7% dead). Telegram requires
bot usernames to end in "bot", so this is a rule, not a correlation.

Citer language is the relevance signal:

| At least one fa/en citer | Targets | Live | Live and fa/en |
|---|---|---|---|
| yes | 220,545 | 105,811 | 58,934 |
| no | 738,141 | 395,786 | 28,546 |

So 23% of probes found 66% of the live fa/en channels, about 6.5x the yield per
probe of the rest.

Hop distance is useless as a gate:

| Hops from a follow | Rows | Live | Live and fa/en |
|---|---|---|---|
| 1 | 5,138 | 2,582 | 2,369 |
| 2 | 2,655 | 1,514 | 1,359 |
| 3+ | 968,805 | 503,990 | 85,646 |

95% of the live fa/en channels are 3 or more hops out. They are reachable
through foreign-language citers, but only rarely.

## Disk

Staging root was 91% full (4.2 GB free of 45 GB). Database 18 GB.

| Object | Size |
|---|---|
| `tg_channel_directory_samples` (6.77M rows, about 13.4 per entry, about 1.2 kB per row) | 7.9 GB |
| `tg_channel_directory_search` | 2.5 GB |
| `tg_post_references` | 1.9 GB |
| `tg_citation_pairs` | 569 MB |
| `tg_channel_directory` | 402 MB |
| channel avatars on the media volume (916k files including `.json` meta) | 7.1 GB |

Rough growth at 25k new rows a day (from size per row): about 500 MB a day,
which leaves about 8 days of headroom. Treat this as an estimate.

## Queries

Run each with these settings first:

```sql
SET default_transaction_read_only = on;
SET max_parallel_workers_per_gather = 0;
SET statement_timeout = '600s';
```

A read-only transaction refuses `CREATE TEMP TABLE`, so use CTEs.

```sql
-- status and kind
SELECT status, kind, count(*) FROM tg_channel_directory GROUP BY 1, 2 ORDER BY 3 DESC;

-- frontier
SELECT count(DISTINCT target_handle) FROM tg_post_references r
WHERE NOT EXISTS (SELECT 1 FROM tg_channel_directory d WHERE d.handle = r.target_handle);

-- probe traffic and refresh backlog
SELECT day, requests FROM tg_directory_probe_usage WHERE day > current_date - 10 ORDER BY day;
SELECT count(*), min(refresh_due_at) FROM tg_channel_directory WHERE refresh_due_at <= now();
SELECT count(*) FROM tg_channel_directory
WHERE status = 'ok' AND created_at < now() - interval '1 day' AND checked_at > now() - interval '1 day';

-- live rate by best reference kind
WITH k AS (
  SELECT target_handle h, bool_or(kind = 'forward') f, bool_or(kind = 'link') l, bool_or(kind = 'reply') r
  FROM tg_post_references GROUP BY 1)
SELECT CASE WHEN f THEN 'forward' WHEN l THEN 'link' WHEN r THEN 'reply' ELSE 'mention only' END,
       count(*) FILTER (WHERE d.status = 'ok' AND d.kind = 'channel') live,
       count(*) FILTER (WHERE d.status = 'unavailable') dead
FROM k JOIN tg_channel_directory d ON d.handle = k.h GROUP BY 1;

-- live rate by distinct citers
SELECT CASE WHEN c.cited_by <= 1 THEN '1' WHEN c.cited_by < 5 THEN '2-4'
            WHEN c.cited_by < 20 THEN '5-19' ELSE '20+' END,
       count(*) FILTER (WHERE d.status = 'ok' AND d.kind = 'channel') live,
       count(*) FILTER (WHERE d.status = 'unavailable') dead
FROM tg_channel_directory d JOIN tg_citation_counts c ON c.handle = d.handle GROUP BY 1;

-- citer language
WITH c AS (
  SELECT p.cited_handle h, bool_or(s.language IN ('fa', 'en')) rel
  FROM tg_citation_pairs p JOIN tg_channel_directory s ON s.handle = p.citing_handle GROUP BY 1)
SELECT rel, count(*),
       count(*) FILTER (WHERE d.status = 'ok' AND d.kind = 'channel') live,
       count(*) FILTER (WHERE d.status = 'ok' AND d.language IN ('fa', 'en')) live_fa_en
FROM c JOIN tg_channel_directory d ON d.handle = c.h GROUP BY 1;

-- hop distance from the follows
WITH f AS (SELECT DISTINCT lower(name) h FROM tg_channels),
h1 AS (SELECT DISTINCT cited_handle h FROM tg_citation_pairs
       WHERE citing_handle IN (SELECT h FROM f) EXCEPT SELECT h FROM f),
h2 AS (SELECT DISTINCT cited_handle h FROM tg_citation_pairs
       WHERE citing_handle IN (SELECT h FROM h1) EXCEPT (SELECT h FROM f UNION SELECT h FROM h1)),
x AS (SELECT h, 1 hop FROM h1 UNION ALL SELECT h, 2 FROM h2)
SELECT coalesce(x.hop, 3), count(*),
       count(*) FILTER (WHERE d.status = 'ok' AND d.kind = 'channel'),
       count(*) FILTER (WHERE d.status = 'ok' AND d.language IN ('fa', 'en'))
FROM tg_channel_directory d LEFT JOIN x ON x.h = d.handle
WHERE d.handle NOT IN (SELECT h FROM f) GROUP BY 1 ORDER BY 1;

-- long tail of live channels
SELECT count(*) FILTER (WHERE last_post_at < now() - interval '90 days'),
       count(*) FILTER (WHERE last_post_at < now() - interval '365 days'),
       count(*) FILTER (WHERE posts_per_week < 1)
FROM tg_channel_directory WHERE status = 'ok' AND kind = 'channel';

-- disk
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class
WHERE relname LIKE 'tg_channel_directory%' OR relname IN ('tg_post_references', 'tg_citation_pairs');
```
