# #50 🐛 Probe sweeps beyond the first batch never started

**State:** closed 2026-07-29 · **Branch:** `discover-probe-chaining` into `main` · **Diff:** +95 / -10 across 3 files · **Opened:** 2026-07-29

---

Follow-up to #49, from the question "do we check all of these channels at least once, or is there a limit?"

There is a limit — `MAX_HANDLES_PER_SWEEP = 400`, with one sweep at a time — but it was never meant to cap coverage: finishing one batch should start the next until the whole report is covered. It didn't.

## The bug

While a sweep ran, each poll tick refetched the report, and the auto-start effect re-requested the shrinking set of unresolved handles. The server dropped those requests in favour of the running job — but the client had already recorded the set in `requestedRef`. So when the sweep finished, the leftover handles looked like something it had already asked about, and the chain stalled.

**Effect:** any report with more than 400 candidates left its tail permanently unprobed. Nothing indicated this; the report simply looked fully triaged when it wasn't.

Clearing the signature on a natural finish lets the next batch start.

## Two hazards that fix introduced

**Cancelled sweeps must not clear it.** Doing so would hand the leftovers straight back to the auto-start effect and restart what the operator just stopped, so the clear is gated on `status === "completed"`.

**"Stop" has to outlast the sweep it cancelled.** Even without the clear, the next report refetch produces a fresh handle set, the effect sees a signature it hasn't asked about, and the sweep restarts. A `stoppedRef` now suppresses auto-start until an explicit recheck lifts it — so Stop means stop.

## Second gap: the retry backoff was unreachable

The client only re-requested handles with *no* probe row. But an inconclusive probe writes a row with `status: "unknown"` — a failed attempt, not an answer — so those handles were never re-requested automatically. The exponential backoff in `handles_needing_probe` was dead code outside manual recheck, and a handle that timed out once stayed stuck.

`unresolvedProbeHandles` now queues both never-probed and inconclusive handles, leaving the server's backoff clock to decide. Asking about a handle that doesn't need it is a cache lookup, which is also what makes it safe to call with a stale copy of the report.

## Verification

- Frontend **658 pass, 0 fail** (up from 654; 4 new tests on the queue rule)
- `tsc -p tsconfig.build.json` clean; biome at its 3 pre-existing warnings
- Frontend-only: no API, migration or backend change

The queue rule was extracted to `unresolvedProbeHandles` specifically so it could be tested — the repo has no DOM/interaction test setup, so the effect wiring around it (signature clearing, `stoppedRef`) is reasoned about but **not** covered by a test. Worth confirming on staging with a report over 400 candidates that the progress bar restarts for a second batch, and that "Stop" stays stopped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Comments

### onhazrat on 2026-07-29

Superseded by the server-side probe redesign: probe orchestration moves out of the React effect entirely, so this PR's diff (requestedRef clearing, stoppedRef, unresolvedProbeHandles) is deleted rather than merged. The retry rule this PR was reaching for already lives server-side in handles_needing_probe. See the follow-up PR for the replacement.
