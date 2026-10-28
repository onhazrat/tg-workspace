# Spec: Accounted work attributes and pays in one place

Status: ready-for-agent

Date: 2026-10-28

Effort prefix: ACW

Source reviewed at local commit `7e301e0874`.

Vocabulary comes from the repository's glossary, including its new **Accounted work** entry. This spec carries out ADR-041, which extends ADR-035. It preserves ADR-035's tiers and its rule that the ledger is the only thing Budgets read, multi-user-tenancy decisions 15, 19 and 20 (what a Request is, charged at completion, answered errors are charged), ADR-014's probe tally, and RQS-15's ledger check.

## Problem statement

When an Operator reads the Requests tab beside the quota ledger, the two are meant to tell the same story: every Charged Request on the tab is a Request some Account's Budget paid for. Today they agree mostly by accident.

The code that decides a Request is Charged exists twice, side by side, in the fetch path: once to count it toward the ledger and once to stamp it on the record. The Account and Budget are stated twice for every piece of work, in two different shapes, at two different depths: once where the charge is opened and once, deeper, where the attribution is set. Nothing makes the two agree. A Request made between those two points would be charged without being attributed. A new kind of work has to remember both halves.

The two halves can already name different Accounts. The ledger charges the resolved owner, which sends a missing or deleted Account to the Operator. The record keeps the raw id. The tab and the daily ledger check each patch that difference on read, and RQS-05's own closing note records one place the patch was missed: a charged Request with no Account is left out of the Accounts facet.

An Operator also cannot see who caused uncharged load. A handle check or a Bot API call records no Account, even though the route that made it knows its caller. Picking an Account in the Requests tab hides every Uncharged Request, so even once recorded, an Account's handle checks would show nowhere.

## Solution

One piece of work opens one Accounted work. It names what the work is: a Channel's sync, a direct sync job, a bulk Follow, a Directory probe, a handle check or a Bot API call. From that, it knows whose Requests they are and what pays for them: an Account's Budget, the Directory's probe tally, or nothing. When the work ends, it pays once and flushes its Requests. The decision that a Request is Charged is made in one place, and the ledger counts exactly the Requests the records mark Charged, under the same Account.

For the Operator nothing changes in the first ticket: the ledger, the Requests tab and every number on it stay the same. In the second ticket, picking an Account in the Requests tab also shows the Uncharged Requests that Account asked for, such as its handle checks and its Bot API calls. The Accounts facet and the comparison still count spend.

## User stories

1. As an Operator, I want every Charged Request on the Requests tab to be one the ledger charged, under the same Account and Budget, so that the tab and the Budgets never tell two stories.
2. As an Operator, I want a sync charged to the Account that owns it, or to me when that Account is gone, and its Requests recorded under that same Account, so that the tab and the ledger agree about who paid.
3. As an Operator, I want the daily ledger check to stay quiet on an ordinary day, so that a warning from it means a charge write really failed.
4. As an Operator, I want the daily ledger check to still warn when a charge write was swallowed, so that a database refusing ledger writes is noticed.
5. As an Operator, I want a sync's Requests still charged to the sync mode's Budget (auto sync, manual bulk or manual single), so that the refactor does not move spend between Budgets.
6. As an Operator, I want a bulk Follow's handle checks still charged to manual bulk, as one charge for the batch, so that a Follow costs what it cost before.
7. As an Operator, I want a Directory probe's Requests still recorded in the probe tally and never in an Account's Budget, so that probing stays deployment load.
8. As an Operator, I want a handle check and a Bot API call to stay Uncharged, so that the ledger does not move when they start naming an Account.
9. As an Operator, I want each Charged Request counted once per answered web view attempt, including a 404, a 429 and a soft block, so that the charging contract is unchanged.
10. As an Operator, I want a transport fault, a picture from the CDN and a Bot API call to stay Uncharged, so that Accounts are not billed for what Telegram never served them.
11. As an Operator, I want a sync charged once, when its work ends, on the day it ends, so that a sync across midnight still checks clean.
12. As an Operator, I want a cancelled or failed sync charged for the Requests it made before it stopped, so that spend is never lost to an error.
13. As an Operator, I want work that made no Charged Request to write no ledger row, so that the ledger keeps only real spend.
14. As an Operator, I want a sync on a best-effort lane still recorded best-effort, and each Request still naming its Channel and job, so that the tab keeps every detail it shows today.
15. As an Operator, I want a sync's run and its failure still counted on one of its Requests, so that the sync and failed-sync counts do not change.
16. As an Operator, I want a handle check to name the Account that asked for it, so that I can see whose checks loaded the proxies.
17. As an Operator, I want a Bot API call to name the Account whose publish or bot request made it, so that I can see whose publishing reached Telegram.
18. As an Operator using View-as, I want work done in a View-as session to name the target Account, as every other write does, so that attribution follows the session's subject.
19. As an Operator, I want an uncharged Request's Account recorded as given, never replaced by me, so that a check by a deleted Account does not appear to be mine.
20. As an Operator, I want work to go ahead when the database cannot say who pays at the start, so that an accounting read never fails a sync.
21. As an Operator, I want work whose owner could not be resolved at the start to still be charged correctly at the end, so that a passing database fault does not misbill it.
22. As an Operator, I want picking Accounts in the Requests tab to keep their Charged Requests and the Uncharged Requests they asked for, so that I can see an Account's whole footprint on Telegram.
23. As an Operator, I want the Charged filter to still separate Charged from Uncharged Requests while Accounts are picked, so that I can return to spend alone.
24. As an Operator, I want the Accounts facet and the comparison table to keep counting Charged Requests, so that they still answer who spends.
25. As an Operator, I want the footer to say what picking Accounts keeps, so that the tab never claims to hide Requests it shows.
26. As an Operator, I want the Bot API kind's colour to stay distinct from the Account colours now that the two can appear together, so that the chart stays readable.
27. As an Operator, I want history recorded before this change to read as it did, including old Requests with no Account shown under me, so that past days do not change.
28. As an Operator, I want the deploy day's possible single ledger-check warning to be expected and explained, so that I do not chase it.
29. As a maintainer adding a new kind of work, I want to name the work and get its attribution, payer and completion from one module, so that I cannot charge without attributing or attribute without charging.
30. As a maintainer, I want opening Accounted work inside other Accounted work to fail loudly, so that a double charge or a charge to the wrong Budget is caught in a test, not on an Account's bill.
31. As a maintainer, I want a guard that fails when kind, Account, Budget or job is set anywhere but the Accounted work module, so that the two halves cannot drift apart again.
32. As a maintainer, I want Channel and best-effort refinements to stay available inside open work, so that the lane consumer and the sync can still say which Channel and lane a Request belongs to.
33. As a maintainer, I want the charge rule written once, so that a change to what counts as Charged changes the ledger and the records together.
34. As a maintainer, I want the request meter module and its separate tally gone, so that there is one way to count a Budget's Requests.
35. As a maintainer, I want the tests to drive the real fetch path under real Accounted work and read the real ledger and records, so that a test cannot pass while the two halves disagree.
36. As a maintainer, I want the backend architecture notes to describe Accounted work, so that the next session does not look for a meter that no longer exists.

## Implementation decisions

### Commit 1 of ACW-01: Accounted work, behaviour-neutral

1. **One module opens Accounted work.** The request accounting orchestrator, which today only runs a charge callable on exit, becomes the only place that sets a Request's kind, Account, Budget and job. It opens the attribution and the tally together, resolves who pays, and on exit pays once and flushes the recorded Requests. It stays an orchestrator in the service kinds inventory.
2. **The work is a closed set of values.** A caller names the work, not the payer:
   - a sync, with its Account, its sync mode and its job;
   - a Follow, with its Account and its follow job;
   - a probe, with the handle it probes;
   - uncharged work, with its kind (Handle or Bot API), the Account that asked if any, and the Channel or handle when known.

   The payer and the Request kind follow from the value. A sync pays from the Budget its sync mode derives, and its kind is auto, bulk or single from that Budget. A Follow pays from manual bulk, kind Follow. A probe pays into the probe tally, kind probe, with no Account. Uncharged work pays nothing. The mapping from Budget to Request kind moves behind the module, and the call sites that build a charge callable go.
3. **One charge rule.** The page record decides whether an attempt is Charged: an answered web view attempt of work that pays from a Budget. The tally counts the records it marks Charged. The fetch path's separate count of quota Requests goes. A probe's tally counts its answered web view attempts by the same rule, without a Budget.
4. **The tally lives with the attribution.** The recording module, which already holds attribution, the page and the sync run in context variables, holds the tally too. The separate request meter module is deleted. The tally is a mutable count shared by every task the work spawns, as the meter's was, so concurrent work for two Accounts keeps separate counts.
5. **Refinements stay public.** Inside open Accounted work, a caller can still narrow the Channel and mark the work best-effort. The lane consumer marks best-effort; the sync of one Channel names that Channel. A refinement cannot set kind, Account, Budget or job.
6. **Who pays is resolved at entry.** Opening charged work resolves its paying Account once, with the existing owner resolution (a missing or deleted Account falls back to the Operator). Records and the ledger both carry the resolved Account. If that read fails, the work proceeds on the raw Account, logs once, and the exit charge resolves again exactly as today.
7. **Uncharged work records the asking Account as given.** A handle check records the route's caller. A Bot API call records the acting Account the publish path already has. Under View-as that is the target Account. Nothing resolves it, because nobody pays and no ledger row is written.
8. **One payment per Accounted work, on exit.** Each charge point pays once, when its work ends, whether it succeeded, failed or was cancelled, and then flushes. A charge or tally write still swallows and logs its own failure, for the reasons the existing charge functions give. Work that made no Charged Request writes no ledger row.
9. **The four charge points stay where they are.** A lane sync message, a direct sync job, a bulk Follow job and a probe message each open one Accounted work where they open their metered block today. A bulk Follow's per-handle attribution becomes a Channel refinement. A sync of one Channel's attribution becomes a Channel refinement plus the sync run. The handle routes and the Bot API calls open uncharged work where they set their attribution today.
10. **Nesting raises.** Opening Accounted work while other Accounted work is open raises. No production path does it today.
11. **The ledger check keeps running and says what it is for.** The daily check that compares Charged Requests with the ledger stays, described as the canary for swallowed charge writes. It drops its per-group owner resolution, because records now carry the paying Account. The tab's read-time fallback of a missing Account to the Operator stays, because daily totals are never pruned and old rows still name no Account.
12. **Nothing the Operator sees moves.** No route, response, schema, migration or browser change. The Requests tab's numbers, the ledger and the probe tally are unchanged for the same work, apart from the Account now named on uncharged Requests, which no screen shows until commit 2.
13. **The backend architecture notes change with the code.** The Quota section describes Accounted work, the one charge rule, entry resolution and the no-nesting rule, and stops describing a meter that nests.

### Commit 2 of ACW-01: The Requests tab shows an Account's Uncharged Requests

14. **Picking Accounts keeps their Charged Requests and the Uncharged Requests they asked for.** The tab's shared filter changes in one place, so the Breakdown, the Trend, the Spread and a Channel's Requests all read it. The Charged filter still narrows to Charged or Uncharged on top of it. Uncharged Requests that name no Account (probes, and handle checks from before commit 1) stay out of a picked Account.
15. **The Accounts facet and the comparison table keep counting Charged Requests.** They answer who spends, and Budgets are spend.
16. **The footer says what picking keeps.** It no longer says picking Accounts hides Uncharged Requests.
17. **The Bot API colour is checked against the Account ramp.** The Bot API kind kept its dataviz slot because it could never appear beside the violet Account ramp. It can now, so the slot is re-validated with the dataviz palette validator, moved to a free slot if it fails, and the unit test that pins the old reasoning is updated.
18. **The route docstrings and generated client say the new rule.** The Requests endpoints' description of `accounts` changes from "only the Requests charged to those Accounts" to the new rule, and the client is regenerated.

## Testing decisions

- **A good test crosses the module's interface and reads what an Operator would read.** For Accounted work, that means opening it as a caller does, making Requests through the real fetch path, and asserting the ledger row, the probe tally and the flushed request records in the worktree's Postgres. It never asserts on the tally object or on context variables directly.
- **Seam 1, commit 1: Accounted work over the real fetch path.** Tests stub only the single-attempt fetch, as the existing ledger tests do, so the retry loop, the page record and the charge decision all run. The cases:
  - one test per work value: sync, Follow, probe, Handle check, Bot API;
  - each mixes answered, 404, soft-blocked and transport-fault attempts, and asserts the Budget charged, the Account on the ledger and the records, and the Charged count equal on both sides;
  - nesting raises;
  - a failed entry read still charges the resolved Account at exit;
  - an Account deleted before the work opens is charged to the Operator on both sides;
  - uncharged work records its asking Account and writes no ledger row.
- **One new guard.** An AST walk fails any module other than the Accounted work module that sets kind, Account, Budget or job on the attribution. It is mutation-checked by adding such a call elsewhere.
- **Every new test is mutation-checked.** Each breaks the rule it guards: count every attempt, keep the raw Account on the records, allow nesting, drop the exit flush, charge uncharged work. The commit body carries the `Mutation-checked:` line.
- **The existing tests are the behaviour-neutral evidence.** The Requests journeys and ledger check tests in the request stats suite, and the charging tests in the quota ledger suite, pass unchanged. The exception is the tests of the deleted meter and of the old completion helper: they are replaced by Seam 1 tests that cover the same rules (concurrent work keeps separate tallies, tasks share their work's tally, a block stops counting when it ends).
- **Seam 2, commit 2: the Requests endpoints and the tab.** This is the same seam the request stats spec used:
  - The endpoint test that picking Accounts keeps only Charged Requests flips to keeping the Account's Uncharged Requests too, with a probe and an Account-less handle check staying out.
  - The breakdown unit tests cover the facet still counting Charged Requests.
  - The Requests tab Playwright journey over the mocked API checks the footer and an Account's Uncharged Requests in the Breakdown.
  - A render test covers any component that gains a branch.
- **Prior art.** The quota ledger suite's fetch tests (stubbed single attempt, real retry loop). The request stats suite's per-kind journeys (sync, bulk Follow, probe, handle check, Bot API), its ledger check tests and its Accounts filter test. The guard pattern of the declared-caller-list tests walked from the AST.

## Out of scope

- Changing what is Charged, what a Request is, or how the ledger, Budgets, lanes or ceilings read spend.
- Writing the ledger per page or per Channel.
- Backfilling Requests or totals recorded before this change.
- Showing uncharged Accounts anywhere but the Requests tab's Account filter. The facet and comparison stay spend.
- A probe naming an Account. Probes are the Directory's work.
- The live job progress duplication between sync jobs and follow jobs, seen in the same review.
- Any change to network logs, which ADR-035 left as a follow-up.

## Further notes

- One ticket, ACW-01, in two commits in order. Commit 1 is the refactor and lands behaviour-neutral: the existing request stats and quota ledger suites pass untouched apart from the deleted meter's tests. Commit 2 changes the Requests tab, which relies on uncharged work naming its Account.
- The deploy can raise one ledger-check warning the next morning, for Requests recorded before the deploy on an unresolved Account. It is expected and needs no action.
- RQS-05's closing note left charged Requests with no Account out of the Accounts facet. Entry resolution means new rows always name the Operator, so the gap closes for new data. History keeps it.
- The design was settled in an architecture review grilling on 2026-10-28; ADR-041 records the decisions and the alternatives rejected.
- The request-kinds effort (ADR-040, prefix RKD) lands first, and ACW-01 rebases onto it. The two touch the same attribution and the same callers (the handle-check routes, publish, bulk Follow, the lane consumer and the sync orchestrator), so the second to land meets textual conflicts there. RKD's refusal in the fetch path reads the Request kind from the attribution, and ACW changes only where the kind is set, so that refusal survives ACW unchanged. A sync refused mid-walk is charged for the Requests made before the refusal, once, on exit; the resumed walk pays for its own. RKD's backend tests (a disabled kind records no Request and charges nothing) join the suites ACW-01 must pass untouched. Accounted work is not RKD's entry point for every kind: it opens in the route for handle checks and Bot API calls, so a refusal there could move into opening Accounted work, but syncs, Follows and probes are refused at the enqueue, route or tick, before anything is queued, while Accounted work opens later, in the consumer, where RKD holds queued work rather than refusing it.
