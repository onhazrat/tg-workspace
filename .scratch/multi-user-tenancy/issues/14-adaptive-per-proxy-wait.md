# 14: Adaptive per-proxy wait

**What to build:** The scraper widens its wait after rejections and narrows it again on sustained success, per proxy, so we stop provoking rate limits without staying permanently slow.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] Wait state is held per proxy and survives across requests
- [ ] Explicit rejection or soft block widens it multiplicatively; sustained success narrows it gradually
- [ ] Latency drift contributes as a weak signal
- [ ] Behaviour is observable in telemetry

## Comments

**Handed over by ticket 13** (`docs/one-worker-per-proxy-plan.md`). Two things
that ticket found and deliberately did not fix, because both are this one's
subject matter.

**A 404 marks a proxy bad, and it should not.** `network.fetch_with_retry`
arms `_bad_proxies` for `NETWORK_PROXY_COOLDOWN_MS` (10 minutes) on any
`is_network` exception, and `httpx.HTTPStatusError` subclasses
`httpx.HTTPError` — so syncing one deleted or private channel puts its proxy in
cooldown. That predates ticket 13. What ticket 13 changed is the consequence:
cooldown used to remove a lane from *selection*, and now it also parks the
worker bound to it, so on a single-proxy deployment one dead handle stops
dispatch for ten minutes.

That is still an improvement on what it replaced — before, the drain kept
dispatching and every queued message failed fast against the cooled proxy,
burning `read_ct` toward `SYNC_QUEUE_MAX_READ_COUNT`; now the messages stay
queued and are simply late. But the underlying rule is wrong, and this ticket
owns it: "explicit rejection or soft block widens the wait" is exactly the
distinction that `is_network` currently fails to draw. A status code is
Telegram answering, not a proxy fault.

**`_NO_HEALTHY_WORKER_WAIT_SECONDS` (5s, `app/jobs/sync_queue.py`)** is how
long a drain waits before concluding no worker is available. If this ticket
introduces deliberate per-proxy waits longer than that, re-derive the constant
from them rather than leaving it a literal.
