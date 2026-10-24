# ADR-035: Every Request is recorded, beside the ledger

**Status:** Accepted (2026-10-22). Plan: `docs/request-stats-prototype-plan.md`.
Spec: `.scratch/request-stats/spec.md` (prefix `RQS`).
Prototype: the Requests tab, variant A, on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d).

## Context

The quota ledger, `tg_quota_usage`, holds one number per Account, Budget and UTC day. It
counts the attempts Telegram answered on the web view, from inside `fetch_with_retry`, and
is written once per metered block. `tg_directory_probe_usage` keeps a daily probe tally.
Handle checks, pictures from Telegram's CDN and Bot API calls are counted nowhere.

So the deployment can say how many Requests an Account spent, and nothing else: not which
Channel they went to, not how many came back with nothing new, not how many a 404 burned
by being retried eight times. Probing grew to about 90% of all traffic before anyone could
see it. Tuning sync cadences and probing needs Requests broken down by kind of work,
Channel and outcome, over hours as well as days.

## Decision

- **A Request is one attempt that reached the network**, on any Telegram host: a web view
  page, a CDN picture, a Bot API call. Every retry is one. An attempt refused before it
  left (a full Lane) is not. This widens multi-user-tenancy decision 15, which counted only
  answered web view attempts, **without changing what is charged**: a Charged Request is
  still an answered web view attempt, and the ledger keeps meaning exactly what it meant.
  Transport faults, pictures and Bot API calls are Uncharged Requests.
- **Each Request is recorded**, at the one choke point, `fetch_with_retry`, into a buffer
  per process that is flushed every few seconds, at the end of each metered block (where
  the ledger is written) and on shutdown. Attribution (kind, Account, Channel or handle,
  Budget) rides the same `contextvars` as the request meter.
- **Three tiers, three spans.** Each Request is kept for `REQUEST_RECORD_DAYS` (7), hourly
  totals for `REQUEST_HOURLY_DAYS` (30), daily totals forever. A job rolls the totals up
  from the Requests every 5 minutes, replacing every hour it touches.
- **Every Request has an outcome, judged by its own answer.** Useful when it made the app
  write something (a new Post, a stored Post's counters or text, Channel metadata, a
  Directory entry, new sample Posts). Idle when it succeeded and wrote nothing. Wasted when
  Telegram turned it away, soft-blocked it, answered with an error, or it never got an
  answer, and when a probe finds that a handle does not exist. A private handle exists,
  so it is not Wasted. Wasted Requests carry a cause in every tier.
- **The ledger stays the only thing Budgets read.** Enqueue and the ceilings still read
  `tg_quota_usage`. A test of the write path and a daily job hold that each day's charged
  daily totals equal the ledger, per Account and Budget.

## Alternatives considered

- **Count Requests in the existing ledger, with more columns.** Rejected: the ledger is
  read on every enqueue and kept forever at a few hundred rows a year. A Channel × outcome
  × hour grain would make it a hot, large table in the one place that must stay small.
- **Extend `tg_network_logs`.** Rejected for now: it is a per-User debugging log with
  payloads, one row per fetch rather than per attempt, written by syncs only. It stays,
  and folding it in is a follow-up.
- **Insert one row per Request as it happens.** Rejected: about 100k writes a day on the
  fetch path. A buffer flushed beside the ledger write costs a few statements per Channel.
- **Keep the outcome as Useful or not.** Rejected: Idle (synced more often than it posts)
  and Wasted (failures and dead handles) have different fixes, and only seeing them apart
  says which one to apply.

## Consequences

- The Requests tab can show where Requests go by kind, Account, Channel, outcome, cause,
  Lane and page type, at 5-minute detail for a week and hourly for a month.
- A hard kill loses the unflushed Requests, as it already loses the pending ledger write.
  The daily check reports the gap.
- Sync, probe and publish code must report whether a page changed anything. Counter
  refreshes, edits and metadata updates return that today only as side effects.
- The probe path must tell a private handle from a missing one. Today the soft-block check
  raises before the page is parsed, so both become "unavailable".
- The meter counts answered attempts and the recording counts every attempt. Two numbers
  for "Requests" now exist, and the glossary's Charged Request is the one Budgets use.
