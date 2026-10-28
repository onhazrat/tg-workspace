# RKD-01: Disabling a Request kind stops it, end to end on the backend

**What to build:** An Operator disables any of the seven Request kinds (auto, bulk, single, follow, probe, handle, botApi) on the deployment, and from then on nothing of that kind leaves for Telegram. New work of that kind is refused with one fixed message wherever it starts; work already queued waits on its lane and runs once the kind is enabled again, including a sync that was mid-walk. Until RKD-02 the switches show as ordinary On/Off rows in Settings, so the feature is usable from this ticket alone. Spec: "What a switch is", "Where it is refused", "Holding queued work", "Independence and the existing switches", and Seam 1 under "Testing Decisions".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Seven deployment Settings, one per switchable kind, declared in the settings registry under Background jobs, each with an `.env` default (enabled unless `.env` says otherwise), stored in the deployment settings table with the moment each was disabled. Changing one needs the Jobs manage Permission and takes effect without a restart.
- [x] One function answers whether a kind is enabled, and every gate below reads it.
- [x] `fetch_with_retry` refuses an attempt of a disabled kind before it leaves and before any Lane permit or pacing wait, raising a distinct "kind disabled" error. The refused attempt is not recorded, charged or retried. `other` is never refused.
- [x] Every entry point in the spec's table refuses with the shared message "`<kind label>` is disabled on this deployment", at one HTTP status used by every route: Sync on one Channel, Sync all, Reset and sync, bulk follow (before its first handle check when `follow` is off), the handle-check routes, publish, bot info and bot files.
- [x] The auto-sync tick checks before it creates a job and enqueues nothing while `auto` is off; the probe sweep enqueues nothing while `probe` is off, scheduled or triggered. The harvest sweep is not gated.
- [x] The consumer holds a lane when it is paused or its kind is disabled (the three tiers of auto, bulk and single, and the probe lane), re-read on the existing pause interval. Lane pause stays its own setting: resuming a lane does not release a disabled kind's work.
- [x] A sync refused mid-walk returns its message to its lane: no failed Channel, no backoff, no terminal job, `next_*_sync_at` untouched, its claim released. It resumes from the sync cursors once enabled. A probe refused mid-way returns to the probe lane the same way.
- [x] A sync job with messages on a held lane reports a waiting reason naming the kind, over SSE and in the reconnect read; it clears and progress resumes on enable.
- [x] A bulk follow with `bulk` off and `follow` on creates the follows, skips their first sync and says so in its response. An auto-publish with `botApi` off still writes the Summary and files a failed publish log naming the disabled kind.
- [x] The runtime config the frontend loads carries the seven switches and their since times.
- [x] A guard fails when any `RequestKind` other than `other` is not switchable or is not refused at the chokepoint.
- [x] Seam 1 tests, against Telegram faked at `network._fetch_once`: the chokepoint per kind, each entry point, holding and release, the mid-walk requeue, the waiting reason, the two independence cases, `.env` defaults, runtime change, permission refusal and the runtime config. Each new test and the guard mutation-checked, named in the commit body.
- [x] Route inventories, permission checks, settings declaration and table-split guards, the request-recording guard and the full backend suite pass.
