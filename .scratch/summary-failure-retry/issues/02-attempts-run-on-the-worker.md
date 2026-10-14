# SFR-02: Attempts run on the worker

**What to build:** Generating a Summary no longer depends on the browser. A Failed Summary gets a Retry that runs on the worker; the text streams into the page, keeps going if the tab closes, and is picked up again when the Summary is reopened, on any device. A running Attempt can be stopped. The Action tab's Generate takes the same path, so a first Generate also survives a sleeping laptop. A Summary refused before its prompt existed can be retried, and a token-limit refusal points to Change selection instead.

Spec: `.scratch/summary-failure-retry/spec.md`; ADR-030 decides that Attempts run on the Sync worker in a Lane of their own. Read the worker, Lane, claim and progress invariants in `CLAUDE.md` and their guards before starting.

**Blocked by:** SFR-01.

**Status:** ready-for-agent

- [ ] A generation Lane, created by a migration, drained by the Sync worker with its own concurrency, separate from the scraping Lanes; scraping throughput is unaffected by a long Attempt.
- [ ] Starting an Attempt records it as `running`, enqueues it and rings the worker as sync enqueues do; the worker claims it, resolves the AI Key through the existing payment rule (the Summary's caller pays), calls the Provider and streams the answer.
- [ ] Progress travels over `LISTEN`/`NOTIFY`; an SSE route lets the page watch an Attempt's text arrive, and a page opened mid-Attempt attaches to it.
- [ ] Only one running Attempt per Summary; a second start is refused.
- [ ] Interrupted Attempts are reconciled when the worker starts, ending `failed` with whatever text they had.
- [ ] Stop cancels a running Attempt over the same channel sync cancellation uses; it ends `stopped` and keeps its text in the Attempt.
- [ ] On success the Summary gets the text and Citations as today, takes the Attempt's model and AI Key, clears its stored prompt and leaves the `failed` status.
- [ ] When no prompt is stored, starting an Attempt builds it from the Summary's frozen Scope.
- [ ] The Action tab's Generate becomes "create the Summary, start Attempt 1"; the browser no longer streams from the Provider, and the old streaming path is removed once nothing calls it.
- [ ] The failure page gains a "Try again" card with Retry (using the last Attempt's model and Key), a running-Attempt card showing the streamed text with Stop, and, when the latest failure is `limit`, "Change selection" as the main action with a note that no AI Key was charged.
- [ ] A finished Summary that took more than one Attempt shows a collapsed "Attempts (n)" fold near its Scope line; one that worked first time looks as it does today.
- [ ] Start joins `VIEW_AS_SPEND_PATHS`; Stop needs an elevation and stamps the acting Owner; watching is a safe read.
- [ ] Backend tests over HTTP with the generation Lane drained by hand and a fake Provider: success, a Provider failure, a stream cut part-way, Stop, a refused second start, worker-restart reconciliation, a retry rebuilding a missing prompt, and an SSE watcher attaching mid-Attempt. Guards met, none loosened: worker-count and Lane guards, cross-process progress, View-as mutation and spend inventories, AI-key callers, account-isolation probes, route inventory and hygiene.
- [ ] Frontend: render tests for the new cards, and the Playwright journey covering Retry streaming into the page, Stop, reopening mid-Attempt and the `limit` page.
