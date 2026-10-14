# SFR-01: Failed Summaries keep their reason

**What to build:** When a Generate breaks, its Summary stays and becomes **Failed** instead of looking like a Copy Prompt item or disappearing. Opening it shows why it failed, every earlier Attempt, and the "Use another AI" path; History shows it as a red card and can filter to Failed Summaries. Generation still streams through today's API route in this ticket; moving it to the worker is SFR-02.

Spec: `.scratch/summary-failure-retry/spec.md`. Terms: **Pending**, **Failed**, **Attempt**, **Partial response** in `CONTEXT.md`. Read ADR-030 first. The prototype's variant F (branch `prototype/summary-error-retry-minimal`) is the visual reference; none of its code is promoted.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

The Attempt record, as the spec fixes it (shape from the prototype):

```ts
type Attempt = {
  id: string
  summaryId: string
  attempt: number                 // 1, 2, 3… per Summary
  outcome: "running" | "succeeded" | "failed" | "stopped" | "kept_partial"
  kind: "quota" | "auth" | "transient" | "model" | "limit" | "empty" | "other" | null
  error: string | null
  model: string
  keyId: string | null
  partialText: string | null
  partialDismissedAt: Date | null
  automatic: boolean
  scheduled: boolean
  startedAt: Date
  endedAt: Date | null
}
```

- [ ] Summaries have a `failed` status beside `pending` and finished; Pending keeps its meaning (a copied prompt waiting for a paste) and a broken Generate is never Pending.
- [ ] A user-owned Attempts table, created by a migration, cascading from its Summary, with one sole-writer aggregate; it is classified in the tenancy seam and sits on neither retention inventory.
- [ ] The existing summary streaming route records an Attempt for every interactive Generate: `succeeded` on a finished answer, `failed` with its error and kind otherwise, with the model and AI Key it ran on.
- [ ] The error kind is decided on the server from the HTTP status and the Provider's error code (429/quota → `quota`, 401/403 → `auth`, 404/unknown model → `model`, prompt-assembly 413 → `limit`, empty answer → `empty`, timeouts/5xx/overload/dropped stream → `transient`), never by matching message text.
- [ ] Generate no longer deletes its Summary when anything after creating it fails: a token-limit refusal, a failed sync or a network failure leaves a Failed Summary with one failed Attempt and no stored prompt. "No posts in range" stays a toast before any Summary is made.
- [ ] A route lists a Summary's Attempts, newest last, with a declared response model; a foreign Summary answers that family's own 404 detail; View-as sessions may read it.
- [ ] Opening a Failed Summary shows the failure page: the report header ("Analysis Report", a red Failed or "Failed ×n" chip, a Copy prompt icon when a prompt exists), the Scope and provenance lines, the latest error in red with its attempt number, model, Key and time, earlier Attempts in a collapsed fold, and a "Use another AI" card with Copy prompt and Paste response (hidden when no prompt exists). A Pending Summary keeps today's panel unchanged.
- [ ] Paste response on a Failed Summary finishes it exactly as it finishes a Pending one today.
- [ ] History shows a Failed Summary as a red card with "Failed ×n" and "n failed attempts"; Pending cards keep the amber "Awaiting response".
- [ ] History has an All / Failed / Pending status filter beside the kind filter, kept in the URL.
- [ ] Backend tests over HTTP: a failing and a succeeding Generate each record the right Attempt and status; the token-limit refusal leaves a Failed Summary; the list route is scoped by owner. Guards met, none loosened: tenancy classification and the flag-off check, account-isolation probes, retention inventories, export and import-write inventories, service kinds, route inventory and hygiene, list-payload cost, approval gate, `tg_*` cleanup inventory.
- [ ] Frontend: render tests for the failure page and the History card states (CRAP ratchet), and the Playwright journey over the mocked API covering a Failed Summary's page, a Pending one's unchanged panel and History's Failed filter, including a phone-sized viewport with no sideways scroll.
