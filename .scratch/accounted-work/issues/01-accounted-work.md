# ACW-01: Accounted work attributes and pays in one place, and the Requests tab shows an Account's Uncharged Requests

**What to build:** Every piece of work that reaches Telegram opens one Accounted work: a queued Channel's sync, a direct sync job, a bulk Follow, a Directory probe, a handle check or a Bot API call. That one module names whose Requests they are and what pays for them, and it pays once when the work ends. The quota ledger and the recorded Requests then come from one charge decision and carry the same resolved Account, so the Requests tab and the Budgets agree by construction. Handle checks and Bot API calls name the Account that asked. Then, picking an Account in the Requests tab also shows the Uncharged Requests it asked for, while the Accounts facet and the comparison still count spend. Land it as two commits in order: the behaviour-neutral refactor first, then the Requests tab change.

**Blocked by:** RKD-01, by agreed order: both rewrite the Request attribution and its callers, and ACW-01 rebases onto RKD-01 and keeps its tests green (spec, Further notes).

**Status:** ready-for-agent

Parent spec: `.scratch/accounted-work/spec.md`, effort ACW. ADR-041 records the decisions and the alternatives rejected. The spec defines the work values, the two seams and the exclusions.

### Commit 1: Accounted work, behaviour-neutral

- [ ] The request accounting orchestrator is the only place that opens Accounted work and the only place that sets a Request's kind, Account, Budget and job. The caller names the work from the closed set in the spec (sync, Follow, probe, uncharged), and the payer and Request kind follow from it. The Budget-to-kind map and the charge callables at the call sites are gone.
- [ ] The decision that an attempt is Charged is made once, when the page records it. The tally counts the records it marks Charged, and the probe tally counts by the same rule without a Budget. The fetch path's separate quota count is gone, and so is the request meter module. The tally lives beside the attribution and is shared by every task the work spawns.
- [ ] Inside open work, callers can still refine the Channel and mark the work best-effort. Nothing else can be set there.
- [ ] Charged work resolves its paying Account once, at entry, and the records and the ledger both carry it. If that read fails, the work proceeds, logs once, and the exit charge resolves again as today. Uncharged work records the asking Account as given (the route's caller, the publish path's acting Account, the target under View-as), unresolved.
- [ ] The four charge points (lane sync message, direct sync job, bulk Follow job, probe message) each pay once on exit, whether the work succeeded, failed or was cancelled, then flush. Charge writes still swallow and log their failures. Work with no Charged Request writes no ledger row.
- [ ] Opening Accounted work inside open Accounted work raises.
- [ ] The daily ledger check stays, described as the canary for swallowed charge writes, and drops its per-group owner resolution. The tab's read-time fallback of a missing Account to the Operator stays.
- [ ] One AST guard fails any module but the Accounted work module that sets kind, Account, Budget or job.
- [ ] Seam 1 tests open Accounted work and drive the real fetch path with only the single attempt stubbed, asserting the ledger, the probe tally and the flushed records in the worktree's Postgres. Coverage: one test per work value; answered, 404, soft-block and transport-fault attempts; nesting; the entry-read fallback; a deleted Account charged to the Operator on both sides; uncharged work naming its Account with no ledger row; concurrent work keeping separate tallies.
- [ ] The existing request stats and quota ledger suites pass with no edits beyond removing the deleted meter's and old completion helper's tests. This is the evidence the commit is behaviour-neutral. No route, response, schema, migration or browser change is in this commit.
- [ ] The backend architecture notes' Quota section describes Accounted work, the one charge rule, entry resolution and the no-nesting rule, and stops describing nesting meters. The service kinds inventory stays accurate.

### Commit 2: The Requests tab shows an Account's Uncharged Requests

- [ ] Picking Accounts keeps their Charged Requests and the Uncharged Requests they asked for, in the one shared filter every Requests endpoint reads. The Charged filter still narrows on top of it. Probes and Account-less handle checks stay out of a picked Account.
- [ ] The Accounts facet and the comparison table still count Charged Requests.
- [ ] The footer no longer says picking Accounts hides Uncharged Requests. It says what picking keeps.
- [ ] The Bot API kind's colour is re-validated against the violet Account ramp with the dataviz palette validator, moved to a free slot if it fails, and the unit test pinning the old reasoning is updated. *Decided 2026-10-29: stays violet.* It fails beside `--account-2` (normal-vision dE 5.2), and the one free slot, red, fails beside `--outcome-wasted` (dE 4.8), which shares every kind row. No chart holds Bot API and an Account colour, so the Operator chose violet; the CSS note and the unit test say why.
- [ ] The Requests endpoints' description of `accounts` states the new rule, and the generated client is regenerated.
- [ ] Seam 2 tests: the endpoint test for picking Accounts flips to include the Account's Uncharged Requests and exclude probes; the breakdown unit tests cover the facet still counting spend; the Requests tab Playwright journey over the mocked API checks the footer and an Account's Uncharged Requests; a render test covers any component that gains a branch.

### Both commits

- [ ] Every new test and the new guard are mutation-checked with `scripts/mutate.py`, with the mutations kept in `.scratch/accounted-work/mutations.json` and named in each commit body as `Mutation-checked: ...`. No existing guard is loosened.
- [ ] Backend lint and type checks, the full backend suite (one run, on the worktree's test database), the frontend unit tests, typecheck and the Requests tab Playwright spec pass.
- [ ] The change stays within the spec: no change to what is Charged, to Budgets, lanes or ceilings, no per-page ledger writes, no backfill.

## Comments
