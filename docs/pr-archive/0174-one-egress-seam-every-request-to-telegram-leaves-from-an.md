# #174 One egress seam: every request to Telegram leaves from an acquired Lane (ticket 36)

**State:** merged 2026-09-04 · **Branch:** `ticket-36-avatar-cache-egress` into `main` · **Diff:** +4828 / -957 across 88 files · **Opened:** 2026-09-04

---

Implements ticket 36 / [ADR-012](docs/migration/ADR-012-egress-seam.md). The
design authority is `docs/proxy-binding-seam-plan.md` — every decision, the
alternative that lost, and the reason.

## The rule

**Every HTTP request to Telegram leaves through an acquired Lane.** Before this
branch, eleven places reached Telegram or a proxy and `bound_to` appeared in
exactly one of them.

Enforced twice. `_fetch_once(*, client: httpx.AsyncClient)` is required and
keyword-only, and the only thing that produces a client is `build_lane_client`
— so a caller holding no Lane cannot reach the network, and the type checker
says so. That is a change from the plan's D15, which asked for a runtime raise
on a contextvar plus a fixture to set it; a required argument is the same rule
without a flag a test could set without acquiring anything. The other half is
`tests/services/test_egress_seam.py`: an AST inventory of every callable in
`app/` allowed to construct an HTTP client, each with a reason, asserted in
both directions.

## One scraping budget instead of four

`run_sync_job`'s `asyncio.Semaphore`, the Discover sweep's `Semaphore(2)`,
bulk follow's `Semaphore(4)` and the queue consumer's gate were four numbers
that each believed they bounded how much of the deployment was scraping. All
four are now Slots out of the single Partition, whose width derives from the
proxy fleet.

`syncConcurrency` is deleted end to end — settings, registry, runtime config,
frontend, and a migration stripping the stored key. The removal is monotonic:
`min(3, sum)` becomes `sum`, so ten one-slot proxies go from 3 concurrent walks
to 10, and a proxy-less deployment keeps what it had via a synthetic direct
Lane. Telegram meters the unauthenticated web view by IP, which is why cooldown
and pacing are keyed per proxy, so a hand-set ceiling of 3 over ten proxies was
throwing away most of the fleet.

## What else moves

- **The avatar cache** fetched every channel photo from the deployment's real
  address. Its twin `cache_post_thumb` had argued against exactly that in a
  docstring five weeks earlier — the twin-module trap `CLAUDE.md` warns about.
- **`_run_whole_job`** is deleted. Cleared by dating `pgmq.meta`: ticket 09's
  lane was created 8.6 hours before ticket 10's migration, all six `q_` tables
  are empty, and 229,759 archived messages carry zero null `channelId`.
  **Checked on staging only** — any other deployment needs the same two queries.
- **`body.proxies`** is gone: a request must not choose its own egress.
- **Discover probes** drain from a seventh lane, strictly after every sync lane
  including best-effort.
- **Bulk follow** moves to the worker on `tg_follow_jobs`, with `pg_notify` for
  progress and cancellation as a column, because an `asyncio.Event` does not
  cross a process.

## Three decisions the plan got wrong

Recorded where they were made rather than quietly dropped: D2 called
`build_workers`'s round-robin dealing dead (it is not — `_take_free` hands out
the first idle worker in list order, so lane-by-lane dealing stacks the first
walks on one proxy); D9's new lowest tier became a declared `NON_SYNC_LANES`
list; D7's queue became a `pg_notify` trigger.

## Review

`/code-review` found 11 issues, 3 serious, all fixed in `446489c`. Two were
covered by tests that could not see them, which is the part worth keeping:

- **The probe lane was enqueued and never drained.** `_LaneBuffers` walked
  `lanes_in_tier(tier)` and the probe lane belongs to no tier. The guard drove
  `LaneScheduler.next_lane` with a hand-built set — it asserted the ordering
  policy while never asking whether the lane reached the scheduler.
- **The API answered every follow-job read with a stale in-memory copy.** Every
  test missed it because they all call `clear_follow_jobs_for_tests()`, which
  empties the dict that was wrong.
- **Two unbounded `slot.acquire()` calls could hang for ever** with every proxy
  parked. The semaphore they replaced always granted.

Both hidden bugs now have tests that go through the real loop, watched failing
against the code as shipped.

## Verification

2231 backend tests, 901 frontend, mypy / ty / ruff / biome clean, 52 migrations
apply to an empty database, single Alembic head, client regenerated with no
diff. 36 guard mutations verified red.

## Known limits, named rather than left implicit

The probe dequeue lease is not renewed (a starved probe is fetched twice,
harmlessly); a Partition rebuilt mid-job leaves that job on the old one until it
finishes; the direct Lane is one width serving two processes with different
traffic profiles.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HshgQsaoT1mCRB2A77MM6e
