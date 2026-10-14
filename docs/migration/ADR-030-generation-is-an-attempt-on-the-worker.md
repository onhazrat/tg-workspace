# ADR-030: Generating a Summary is an Attempt, run on the worker

**Status:** Accepted (2026-10-14). Serves the Summary failure-and-retry work;
the prototype is the branch `prototype/summary-error-retry-minimal`, variant F.

## Context

A Summary is generated inside the API request that streams it to the browser.
When the browser goes away (a laptop sleeps, a phone changes networks, a tab
closes) the stream dies and the Summary is left Pending, the same state a
Copy Prompt item waits in by design. Why it failed reaches only a toast and a
failed row in the AI logs, and logs are pruned for space. A refusal before the
prompt is built (the token limit) deletes the Summary and leaves nothing but
the toast. Unattended scheduled regenerations fail into the logs alone.

## Decision

Three parts, one reason: a Summary's generation must outlive both the browser
and log retention.

- **Every generation is an Attempt, stored in its own table** (one per Summary,
  user-owned, deleted with its Summary, on neither retention inventory). An
  Attempt records its outcome, error kind, error, model, AI Key, whether it was
  automatic, and any Partial response. Attempts are never pruned with Logs;
  only dismissed Partial responses are trimmed after a while.
- **Every Generate creates its Summary first.** A refusal before any prompt
  exists is a Failed Summary with one Attempt, not a deleted row. Failed is a
  state of its own, distinct from Pending.
- **Attempts run on the Sync worker, in a Lane of their own,** never inside an
  API request. The page starts one and watches it over SSE, and attaches again
  if it is reopened mid-run. The worker owns the single automatic retry of a
  transient failure; Stop cancels a running Attempt over the same channel sync
  cancellation uses. Scheduled regenerations take the same path.

## Alternatives considered

- **Record failures in the LLM logs** (they already hold the reason).
  Rejected: logs are a separate entity pruned for space, so a Summary's history
  would vanish with them.
- **Keep generating in the API request and reconnect on failure.** Rejected: it
  treats the symptom; a closed tab still kills the Attempt, and a scheduled
  regeneration has no browser at all.
- **A detached background task in the API process.** Rejected: lost on an API
  restart and duplicated when the API tier scales out; the worker already has
  a queue, claims, cancellation and cross-process progress.
- **Keep refusals in browser memory only.** Rejected for consistency: every
  failure belongs to a Summary, and History's Failed filter finds them all.

## Consequences

- Summaries gain a `failed` status; History gets an All / Failed / Pending
  filter, and Failed Summaries are never discarded automatically.
- A scheduled chain does not stall on a failure: the Failed successor carries
  the chain, and each missed window stays behind as one Failed Summary.
- The Summary takes the model and AI Key of the Attempt that finished it.
- Starting an Attempt spends an AI Key, so its routes join
  `VIEW_AS_SPEND_PATHS`; keeping, dismissing and restoring Partial responses
  are writes needing elevation.
- A kept Partial response makes the Summary Incomplete; scheduled
  auto-publish skips Incomplete Summaries.
