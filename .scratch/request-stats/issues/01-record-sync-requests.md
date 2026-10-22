# RQS-01: Record sync Requests and serve their totals

**What to build:** Every attempt a Channel's sync makes is recorded as a Request: its Posts pages, and the pictures and metadata pages it fetches along the way. The Operator can read the totals by kind of work and by Channel for any range through a new Operator-only Breakdown endpoint. This is the tracer bullet: recording at `fetch_with_retry`, a buffer per process, the rollup job and one endpoint, each in its simplest complete form. Spec: "What a Request is", "Outcome", "Recording", "Totals", and the Breakdown under "The API".

**Blocked by:** None (can start immediately)

**Status:** done

- [x] One Request per attempt that reached the network, on every Telegram host the sync touches (web view and CDN). An attempt refused locally (full Lane) records nothing.
- [x] Each Request carries time, latency, kind (auto, bulk or single from the sync mode), Account, Budget, charged (answered web view attempts only), best-effort, Channel, Lane (host and port with credentials stripped, or `direct`), page type, attempt, chain id, new and repeated Posts on a Posts page.
- [x] The chain id ties a page's attempts across `fetch_with_retry`'s retries and the page's outer retries; a queue redelivery starts a new chain.
- [x] Outcome: Useful when the page brought a new Post, Idle when it succeeded and brought none (counters, edits and metadata come in RQS-11), Wasted with cause turned away, soft block, answered error or transport fault, and the error code. A retry that brings the page is not Wasted.
- [x] Attribution rides a recording context in `contextvars`, set by the sync; the buffer flushes every few seconds, in the same `finally` that writes the ledger, and on shutdown, off the event loop and without holding a session across `await`.
- [x] A job every 5 minutes recomputes each touched hour (open hour included) from the per-Request rows, replacing those hourly rows, then rebuilds those days' daily rows; running it twice changes nothing; a late Request recomputes its hour.
- [x] Hourly totals keep kind × Account × Channel × outcome × cause × page type × Lane × best-effort with Requests, charged, new and repeated Posts; daily totals the same without Lane and best-effort.
- [x] The new tables are classified, with reasons, in tenancy scopes, the retention inventories, the `tg_*` cleanup inventory and the service-kind inventory.
- [x] Breakdown endpoint: Operator-only (`QUOTA_READ_ANY`), takes a range to the minute in UTC and Charged/Uncharged, answers totals by kind and by Channel from daily totals (hourly for a cut day), through a response model and the regenerated client; a non-Operator is refused.
- [x] The quota ledger and its tests are unchanged.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23: implemented on `claude/rqs-01` and merged into the integration branch in 34ba5036e0cf14684f7863b33e86dc7a1d2b36ad (fast-forward).
  Open: syncs and failed-syncs counts are not in the Breakdown yet (nothing records them), handed to RQS-04; cause, error code and chain id are checked from `tg_request_records` directly until RQS-10 serves them; a legacy sync with no owner records `account_id` null while the ledger bills the Operator, for RQS-15.
