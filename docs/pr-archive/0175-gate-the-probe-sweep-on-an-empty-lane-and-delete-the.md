# #175 Gate the probe sweep on an empty lane, and delete the dequeue lease

**State:** merged 2026-09-04 · **Branch:** `probe-lane-depth-gate` into `main` · **Diff:** +213 / -54 across 5 files · **Opened:** 2026-09-04

---

Closes the one limit ticket 36 left open that could cause duplicate work.

## Why the lease had to go rather than be renewed

Ticket 36 moved the probe fetch out of the tick that selects the work. A handle
keeps `status='unknown'` until a verdict arrives from the consumer, so every
tick re-selected what the previous one had queued. A `retry_after` lease
stopped that flood, and had two problems:

- **Nothing could renew it.** A message sitting on a lane is claimed by nobody,
  so there is no holder to refresh from. Renewal would need a second loop
  walking the lane to touch rows for work that has not started.
- **It was a second lease over the same messages.** `retry_after` owned by the
  sweep, pgmq's visibility timeout owned by the consumer, different clocks.

The probe lane drains strictly after every sync lane, so a probe starved behind
a `sync_all` or a large bulk follow for longer than an hour had its lease lapse
and came back as a duplicate — roughly one extra copy per handle per hour of
starvation. Wasted `t.me` fetches taking Slots from the same Partition sync work
wants, and a lane that grows while starved.

## The gate

The sweep enqueues nothing while the lane holds anything. `queue_length` counts
due **and** in-flight messages (a claimed one stays in `q_` with a future `vt`),
so a handle that is queued or being fetched keeps the gate shut and cannot be
selected again however long it waits.

Emptiness is the lane's own answer to "what is outstanding". The lease was a
second copy of that answer which could go stale. `dequeue_handles` is a pure
read again, and `retry_after` means one thing: the failure backoff, written only
by `record_probe_result`.

## Cost, stated

A duty cycle. The lane drains, then waits up to `DISCOVER_PROBE_JOB_INTERVAL_SECONDS`
before refilling, so a large first-run backlog clears in roughly twice the time.
Probing is the lowest-priority work on the deployment by construction, and the
tick interval is the dial if it ever matters. Steady state is a few new handles
per Discover report.

## Verification

2235 backend tests pass, lint clean. Three mutations verified red, including
removing the gate — which reproduces the exact duplicate the lease existed for.

A fourth mutation **passed** against my first pure-read guard: it compared
`probe_map`'s projection, which does not carry `attempts`, so it was comparing
`None` to `None`. The guard now snapshots every column off the model and catches
a write to `attempts` and `retry_after` alike.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HshgQsaoT1mCRB2A77MM6e
