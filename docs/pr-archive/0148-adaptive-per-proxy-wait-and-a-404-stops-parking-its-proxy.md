# #148 🐌 Adaptive per-proxy wait, and a 404 stops parking its proxy (ticket 14)

**State:** merged 2026-08-28 · **Branch:** `worktree-ticket-14-adaptive-proxy-wait` into `main` · **Diff:** +2088 / -19 across 10 files · **Opened:** 2026-08-28

---

Closes ticket 14 (`.scratch/multi-user-tenancy/issues/14-adaptive-per-proxy-wait.md`).
Plan and reasoning: `docs/adaptive-per-proxy-wait-plan.md`.

Two commits: the implementation, then a round of fixes from a `/code-review high` pass.

## The bug ticket 13 handed over

`fetch_with_retry` armed the ten-minute proxy cooldown on any `is_network`
exception, and `httpx.HTTPStatusError` subclasses `httpx.HTTPError` — so **a 404
from one deleted channel put its proxy in cooldown**. That predates ticket 13.
What ticket 13 changed is the consequence: a cooldown now parks the worker bound
to that lane, so on a single-proxy deployment one dead handle stopped dispatch
for ten minutes. The failure is silent — throughput halves and nothing is in
error.

## What replaces it

`services/proxy_pacing.py` (a pure transform, for `sync_lanes.py`'s reason)
turns the one predicate into seven named outcomes:

| Outcome | Cooldown | Pace |
|---|---|---|
| `SUCCESS` | cleared | narrows on a *run* of successes |
| `TRANSPORT_FAULT` | **armed** | unchanged |
| `REJECTION` (429/403/5xx) | at the ceiling, or at once if unpaced | **widens x2** |
| `SOFT_BLOCK` | never | **widens x2** |
| `ANSWERED_ERROR` (404/410/451) | no | unchanged |
| `LOCAL_CONGESTION` | no | unchanged |
| `UNKNOWN` | no | unchanged |

Cooldown becomes the **top rung of the same ladder** rather than disappearing: a
proxy already paced to `PACE_MAX_MS` and still being refused has run out of ways
to be polite. A soft block never reaches that rung, because a channel Telegram
will not serve on the web view is soft-blocked for every egress equally.

Latency drift is a weak signal with two numbers behind the word: it widens by
1.25 against a rejection's 2.0, and never past 5s against the full 30s ceiling.

## What the review changed

- **The sleep was served while holding the lane permit.** The cursor already
  spaces the starts, so the permit contributed no pacing — while it parked every
  other kind of traffic on that proxy behind the sleep. At the ceiling on a
  one-slot lane that is four requests per `ACQUIRE_TIMEOUT_SECONDS`. Exactly what
  ticket 13's `hold()` docstring forbids. The wait now happens before the
  acquire, and the structural guard is **inverted rather than deleted**.
- **Latency included time queued for that permit**, so ordinary contention (a
  page fetch behind ~20 thumbnails) read as a spike and throttled a healthy
  proxy. Now timed from just before the request.
- **A rejection on unpaced traffic stopped parking a broken proxy.** Only
  web-view requests are paced, so the ceiling rung was unreachable for
  thumbnails and publishes and a proxy answering 502 stayed in rotation for ever.
  `should_arm_cooldown` takes a required `paced` keyword.
- **`_worst_case_fetch_seconds` was the constant ticket 13 was really asking
  about** — the first cut answered for the drain constant, which turned out not
  to need it, and left the visibility timeout under-counting by up to 240s.
- Plus: a cancelled sleep gives its turn back, a dead helper removed, and a
  comment claiming a leak guard that did not exist corrected.

## Things worth a reviewer's attention

- **The retry predicate is deliberately unchanged.** It also decides how many
  attempts a status code gets, which is ticket 08's charging contract (one
  Request per answered attempt, eight attempts in production). Narrowing it here
  would quietly re-price the quota ledger while fixing something else.
- **A full lane queue is no longer a proxy fault.** `_proxy_acquire` translated
  `ProxyPoolExhausted` into a bare `ConnectionError`, which the old rule filed
  with the dead proxies — self-reinforcing once pacing lands, since a paced lane
  is what makes its own queue deep. Now `ProxyLaneUnavailable`, still a
  `ConnectionError` so nothing above notices.
- **`test_service_kinds` narrows its `httpx` ban** from the bare import to
  constructing a client, following the precedent already written into that
  guard's docstring for `sqlalchemy`. The half that bites is a separate check.

## Verification

- 1862 passed, 2 skipped — full backend suite, fresh isolated database.
- mypy strict, ty, ruff all clean.
- **33 mutations run against the guards; all 33 killed.** Ten survived a first
  pass across two rounds, each a real guard defect: a test reading the constant
  it verified, two blind to the first-request-free case, a worker with no lane so
  `is_parked` short-circuited, a bound the backoff term already satisfied, and
  three mutations that were equivalent code.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01DuJuXXMkbvSsRGyLBZscxD
