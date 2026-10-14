# Summary failures: see why, retry with any Key, keep what was written

Status: ready-for-agent

Ticket prefix: `SFR`.

Settled by a UI prototype on live staging data and three rounds of decisions (2026-10-14). Six
variants were tried on branch `prototype/summary-error-retry-minimal` (local, not pushed); the
chosen one is **F**, and its README in the prototype directory lists what it does and how to run
it. The terms **Pending**, **Failed**, **Attempt**, **Partial response** and **Incomplete** are in
`CONTEXT.md`. **ADR-030** records that generating a Summary is an Attempt, stored on its own and
run on the worker; read it, and ADR-016 (who pays) and ADR-017 (spend sessions), before changing
how a Summary is generated.

## Problem Statement

When I press Generate and it fails, the Summary tab tells me almost nothing. The reason appears
once as a toast in the corner and is gone. The tab then shows "Awaiting External Response" and
"Prompt copied", as if I had chosen to run the prompt in another tool, when in fact the app's own
run broke.

I can't retry from there. The only way forward is to paste an answer from somewhere else, or go
back to the Action tab and start again. I can't try a different model or a different AI Key for
this Summary, even though my other Keys might work. If it fails again I lose the first reason, so
I can't tell a quota problem from an overloaded provider.

If my laptop sleeps or my phone changes networks halfway through a long report, the stream dies
and everything the model had already written is thrown away. When the selection is too big
(over the token limit), the Summary is deleted and only the toast says why. Scheduled
regenerations fail silently into the AI logs, which are pruned for space. History shows broken
Summaries and Copy Prompt items with the same "Awaiting response" badge.

## Solution

A Summary whose generation breaks becomes **Failed**: a state of its own, shown in the
finished report's own layout, with red marking in History. The page shows the latest error, and
every earlier **Attempt** with its error, model, AI Key and time, in a fold. A "Try again" card
has Key and Model chips like the Action tab's "Run with" bar, so I can retry on any of my Keys
with any model that Key offers. A warning tells me before a retry if the saved prompt won't fit
the chosen model. A "Use another AI" card keeps the copy-and-paste path.

Attempts run on the worker, not inside my browser's request. I can close the tab, reopen the
Summary and watch the same Attempt still streaming, and I can **Stop** it. If an Attempt is cut
off or stopped, the text it produced is kept as a **Partial response**. I can keep one as the
Summary's text (which makes it **Incomplete**), dismiss it, or restore it later. An overloaded
or dropped Attempt is retried once automatically after a short countdown I can cancel.

Every Generate creates its Summary before anything else, so even a refusal before the prompt is
built (the token limit) leaves a Failed Summary I can find, with "Change selection" as the way
out. Scheduled regenerations record their Attempts the same way, and History can filter to just
the Failed ones.

## User Stories

1. As an Account, I want a failed Generate to leave a Summary marked Failed, so that I can tell it apart from a prompt I copied on purpose.
2. As an Account, I want a Failed Summary to show the reason it failed on the page itself, so that I don't have to catch a toast before it disappears.
3. As an Account, I want the failure page to use the finished report's header, Scope line and provenance line, so that it reads as the same Summary, just not finished.
4. As an Account, I want the latest error shown prominently and every earlier Attempt listed in a fold, newest first, so that a second failure doesn't erase the first reason.
5. As an Account, I want each Attempt to show its model, AI Key, time and whether it was automatic, so that I can see what I already tried.
6. As an Account, I want to retry a Failed Summary from its page, so that I don't have to rebuild the same selection on the Action tab.
7. As an Account, I want Key and Model chips on the retry, like the Action tab's "Run with" bar, so that I can retry on a different Key when one is out of quota.
8. As an Account, I want the model list to come from the Key I chose in the retry, so that I can pick a model only that Key offers.
9. As an Account, I want switching the retry's Key to restore the model I last ran on that Key, so that I don't retype it.
10. As an Account, I want choosing a Key and model for a retry to leave my Action tab's selection and each Key's remembered model alone, so that one rescue doesn't change my defaults.
11. As an Account, I want the retry's Key and model to start at what the last Attempt used, so that a plain retry repeats it without setup.
12. As an Account, I want a warning before retrying when the saved prompt is larger than the chosen model's context window, so that I don't spend a Key on a request that cannot fit.
13. As an Account, I want a softer warning when the prompt fills most of the model's window, so that I know little room is left for the answer.
14. As an Account, I want the size warning to advise and not block, so that a rough estimate never stops me from trying.
15. As an Account, I want the Attempt to keep running when I close the tab or my device sleeps, so that a long report still finishes.
16. As an Account, I want to reopen a Summary while its Attempt runs and see the text arriving where it left off, so that I can follow it from any device.
17. As an Account, I want the text to stream into the page during a retry, so that I can see quickly whether it is working.
18. As an Account, I want a Stop button on a running Attempt, so that I can stop paying for an answer I can see is going wrong.
19. As an Account, I want a stopped Attempt to keep the text it produced, so that stopping doesn't throw away what I already read.
20. As an Account, I want only one Attempt running per Summary at a time, so that two retries can't overwrite each other.
21. As an Account, I want an overloaded, timed-out or dropped Attempt retried once automatically, so that a passing provider hiccup fixes itself.
22. As an Account, I want a countdown before the automatic retry with a Cancel button, so that I stay in control of spending.
23. As an Account, I want the automatic retry to wait as long as the provider asked, so that it doesn't hit the same overload again.
24. As an Account, I want quota, rejected-Key, unknown-model and too-large failures never retried automatically, so that the app doesn't spend on a retry that will fail the same way.
25. As an Account, I want the automatic retry to happen even when no tab is open, so that a scheduled Summary recovers too.
26. As an Account, I want the text a cut-off or stopped Attempt produced kept as a Partial response, so that half a briefing isn't lost.
27. As an Account, I want every Partial response listed, newest first, with its Attempt, model, length and time, so that I can choose the best one.
28. As an Account, I want to keep a Partial response as the Summary's text, so that I can use it when it's good enough.
29. As an Account, I want a Summary finished from a Partial response marked Incomplete and showing where its text stops, so that nobody mistakes it for a full report.
30. As an Account, I want an Incomplete Summary still retryable, so that I can replace it with a full one later.
31. As an Account, I want to dismiss a Partial response I don't need, so that the list stays short.
32. As an Account, I want to restore a dismissed Partial response, so that a mistaken dismiss isn't permanent.
33. As an Account, I want a "Use another AI" card with Copy prompt and Paste response on a Failed Summary, so that I can still finish it with any tool.
34. As an Account, I want a Generate refused before the prompt was built (too many tokens) to leave a Failed Summary, so that the reason stays somewhere I can find it.
35. As an Account, I want "Change selection" as the main action when the refusal was the token limit, so that I'm sent to the fix rather than a retry that cannot work.
36. As an Account, I want to see that a refused Generate charged no AI Key, so that I'm not worried about cost.
37. As an Account, I want a retry of a Summary with no prompt yet to build the prompt from the Summary's frozen Scope, so that a passing sync or network failure can be retried as it is.
38. As an Account, I want "Use another AI" hidden until a prompt exists, so that I'm not offered a copy of nothing.
39. As an Account, I want a Summary finished by a retry to record the model and AI Key that actually wrote it, so that the next scheduled run pays with the right Key.
40. As an Account, I want a finished Summary that took more than one Attempt to show a collapsed "Attempts" fold, so that its history stays available without cluttering a good report.
41. As an Account, I want a Summary that worked first time to look exactly as it does today, so that nothing changes when nothing went wrong.
42. As an Account, I want History to show a Failed Summary with a red card, "Failed ×n" and the number of failed Attempts, so that broken Summaries stand out.
43. As an Account, I want History's Copy Prompt items to keep their amber "Awaiting response" badge, so that waiting by design still looks like waiting.
44. As an Account, I want a History filter for All, Failed and Pending, kept in the URL, so that I can find and clear broken Summaries quickly.
45. As an Account, I want Failed Summaries kept until I delete them, so that nothing disappears behind my back.
46. As an Account, I want a scheduled regeneration that fails to leave a Failed Summary with its Attempt, so that an unattended failure is visible in History.
47. As an Account, I want a scheduled chain to keep moving after a failed tick, the Failed Summary carrying the chain forward, so that one bad window doesn't stall every later one.
48. As an Account, I want each missed scheduled window left behind as one Failed Summary I can retry by hand, so that I can fill the gap later.
49. As an Account, I want a quota failure to still switch auto-regenerate off, so that a scheduled chain doesn't keep spending against an empty Key.
50. As an Account, I want scheduled auto-publish to skip Incomplete Summaries and say so in the publish log, so that a channel never receives a cut-off briefing unattended.
51. As an Account, I want to publish an Incomplete Summary by hand with a line marking where it stops, so that I can still send it when I choose.
52. As an Account, I want Attempts kept for the life of their Summary and never pruned with the AI logs, so that a Summary's history survives log retention.
53. As an Account, I want dismissed Partial responses trimmed after a while, so that bulky text I said I don't need doesn't grow forever.
54. As an Account, I want a Summary's Attempts deleted with it, so that deleting a Summary removes everything about it.
55. As an Owner in a View-as session, I want reading another Account's Attempts allowed, so that I can see why their Summaries fail.
56. As an Owner in a View-as session, I want starting an Attempt on their Summary to require a Spend session, so that their Key is never charged by accident.
57. As an Owner in a View-as session, I want keep, dismiss and restore to require an elevation, so that writes to their Summary are deliberate and attributed.
58. As an Account, I want another Account never to see or touch my Attempts or Partial responses, so that my failed reports stay private.
59. As an Account on a phone, I want the failure page, the cards and the Partial response list to stack and fit without sideways scrolling, so that I can rescue a Summary from my phone.
60. As an Account, I want a Paste response on a Failed Summary to finish it as it does today, so that the paste path keeps working.
61. As an Operator, I want Attempts to run in their own worker Lane, so that a long Summary never delays scraping.
62. As an Operator, I want a worker restart to leave no Attempt claimed forever, so that an interrupted Attempt is recorded as failed and can be retried.

## Implementation Decisions

- **Summary state.** Summaries gain a `failed` status beside `pending` and finished (null). Pending keeps its meaning exactly: a Copy Prompt item waiting for a pasted response. Failed means the latest Attempt did not finish. A Failed Summary can be retried, finished by Paste response, or finished by keeping a Partial response. A Summary finished from a Partial response carries an incomplete marker, and its text records where it stops.
- **Create first.** The interactive Generate submits its Summary before building the prompt (it already does) and no longer deletes it when anything after that fails. A refusal before the prompt exists, such as the token-limit 413, a failed sync or a network failure, becomes a Failed Summary with one failed Attempt and no stored prompt. The "no posts in range" check stays before the Summary is created and stays a toast, because nothing was asked for.
- **Attempts table.** A new user-owned table of Attempts, one row per request for a Summary's prose. It cascades from its Summary and is classified in the tenancy seam as user-owned. It is on neither retention inventory, except that a dismissed Partial response's text is cleared after a fixed number of days, a deployment setting. Its aggregate is the sole writer. Shape, from the prototype:

  ```ts
  type Attempt = {
    id: string
    summaryId: string
    attempt: number                 // 1, 2, 3… per Summary
    outcome: "running" | "succeeded" | "failed" | "stopped" | "kept_partial"
    kind: "quota" | "auth" | "transient" | "model" | "limit" | "empty" | "other" | null
    error: string | null            // what the provider or the server said
    model: string
    keyId: string | null
    partialText: string | null      // text produced before the cut or Stop
    partialDismissedAt: Date | null
    automatic: boolean              // started by the automatic retry
    scheduled: boolean              // started by the scheduler
    startedAt: Date
    endedAt: Date | null
  }
  ```

- **Error kind is decided on the server** from the HTTP status and the provider's error code, never by matching message text: 429 or a quota code is `quota`; 401/403 is `auth`; 404 or an unknown model is `model`; the prompt-assembly 413 is `limit`; an empty answer is `empty`; timeouts, 5xx, overloads and dropped connections are `transient`. The kind drives the automatic retry and the page's main action.
- **Generation Lane.** Attempts run on the Sync worker in a new Lane of their own, separate from the scraping Lanes and with its own concurrency, so scraping is never starved by a long Summary. Starting an Attempt enqueues it and rings the worker as sync enqueues do. The worker claims it, calls the Provider through the existing Key resolution (the Summary's caller pays, per ADR-016), streams the answer, and writes the text and progress through the existing `LISTEN`/`NOTIFY` path. An SSE route lets the page watch an Attempt, and a page opened mid-Attempt attaches to it. One running Attempt per Summary: a second start is refused. Interrupted Attempts are reconciled on worker start, as interrupted sync jobs are, and become failed with whatever text they had.
- **Starting an Attempt** takes an optional AI Key and model (defaulting to the last Attempt's). It rebuilds the prompt from the Summary's frozen Scope when no prompt is stored. Success writes the text, sets the Summary's model and AI Key to the Attempt's, clears the stored prompt as a finished Summary does today, and resolves Citations as today. The interactive Generate becomes "create the Summary, start Attempt 1"; the browser no longer streams from the Provider itself.
- **Stop** cancels a running Attempt over the same channel sync cancellation uses. It ends as `stopped`, keeping its text as a Partial response, and is never retried automatically.
- **Automatic retry** belongs to the worker. A `transient` failure that was not itself automatic and not stopped is re-queued once, after the provider's Retry-After or ten seconds. The page shows the countdown and can cancel it before it fires. Scheduled Attempts follow the same rule.
- **Partial responses.** Keep finishes the Summary with that Attempt's text, marks it incomplete, records a `kept_partial` Attempt, and sets the Summary's model and Key to that Attempt's. Dismiss sets the dismissed time and Restore clears it; neither deletes text.
- **Model context windows.** The model listing for a Key returns each model's context length when the Provider offers one (OpenRouter does; Gemini ids are known by rule; an OpenAI-compatible endpoint without it returns none). The page estimates the saved prompt at the backend's existing four characters per token. It warns "won't fit" past the window and "tight" past 80% of it, and never blocks. No warning shows when the window is unknown or no prompt is stored.
- **Scheduled regenerations.** A tick creates its successor Summary first, as the interactive path does, and records Attempts. A failed tick leaves that successor Failed, and the chain moves on: the Failed successor takes over auto-regenerate from its predecessor, so the next tick derives the following window from it. A quota failure switches auto-regenerate off, as today. Auto-publish skips an Incomplete Summary and files a skipped publish log row.
- **Publishing an Incomplete Summary by hand** is allowed. Its last Part ends with a line saying where the text stops.
- **View-as.** Starting an Attempt (and therefore Retry) joins `VIEW_AS_SPEND_PATHS`. Stop, Keep, Dismiss and Restore are writes needing elevation and stamp the acting Owner like every other write. Reading Attempts and watching an Attempt are safe reads.
- **Routes** sit under the Summary they belong to: list Attempts, start, stop, watch (SSE), keep a Partial response, dismiss, restore. Every route declares a response model; the list returns Partial responses' text (Summaries rarely have many) and its size is guarded like other list payloads. Foreign Summaries answer the Summary family's own 404 detail.
- **History** gains a status filter (All / Failed / Pending) in the URL beside the kind filter. A Failed Summary's card is red with "Failed ×n", "n failed attempts", and a line saying it can be retried, finished from a Partial response or answered by paste. Pending cards are unchanged.
- **Summary tab.** A Failed Summary renders the failure page from prototype F: the report header with a Failed chip and a Copy prompt icon, the Scope and provenance lines, the latest error, earlier Attempts in a fold, a running-Attempt card while one streams (with Stop), the countdown with Cancel, the Partial responses card with a "Dismissed (n)" fold, the "Try again" card (Key and Model chips, size warning, Retry), the "Use another AI" card, the saved prompt folded, and the Scope line with "Use this Scope". When the latest failure is `limit`, "Change selection" is the main action and "Use another AI" is hidden. A Pending Summary keeps today's panel. A finished Summary with more than one Attempt gets a collapsed "Attempts (n)" fold near the Scope line.
- **The retry's Key and model** never write the account's selected Key or a Key's remembered model.

## Testing Decisions

- **A good test drives the outside**: HTTP requests and the rows and events they return, or a person's clicks and what the tab then shows. No test reaches into a hook's state, a query's SQL or a component's internals.
- **Backend, through the Attempt routes with a hand-drained Lane.** Start an Attempt over HTTP, drain one generation message the way `test_lane_draining.py` drains sync Lanes, with a fake Provider at the existing provider-resolution seam, then read Attempts and the Summary over HTTP. Cases:
  - success finishes the Summary with the Attempt's model and Key
  - a 429 records `quota` and no automatic retry
  - a 503 records `transient` and queues exactly one automatic retry, which does not queue another
  - a stream cut part-way keeps its Partial response
  - Stop ends `stopped` with its text
  - a second start while one runs is refused
  - a restart reconciles a claimed Attempt to failed
  - keep marks the Summary incomplete; dismiss and restore round-trip
  - a token-limit refusal leaves a Failed Summary with a `limit` Attempt and no prompt
  - a retry with no stored prompt rebuilds it from the frozen Scope

  Prior art: `test_lane_draining.py`, `test_sync_jobs.py`, `test_ai_summary.py`, `test_cross_process_progress.py`.
- **Backend, the SSE watch.** A watcher sees text arrive before the row is written and attaches mid-Attempt. Prior art: `test_cross_process_progress.py`, `test_ai_chat_stream.py`.
- **Backend, the scheduler.** A failed tick leaves a Failed successor carrying the chain, the next tick derives the following window from it, and a quota failure switches auto-regenerate off. Auto-publish skips an Incomplete Summary and logs it. Prior art: the auto-summary and auto-publish tests, `test_auto_publish_scoping.py`, `test_llm_log_provenance.py`.
- **The guards each ticket will meet:**
  - the tenancy classification and the flag-off byte-identical check
  - the account-isolation probes for every new route
  - the View-as mutation inventory, with Start in `VIEW_AS_SPEND_PATHS`
  - the AI-key caller list
  - the retention inventories (Attempts on neither, and the dismissed-text trim declared)
  - the export inventory (Attempts travel with their Summary)
  - the import write-scoping inventory
  - the service-kind inventory, route inventory and route-module hygiene
  - the list-payload cost guards
  - the approval gate
  - the worker-count and lane guards (the new Lane created by a migration)
  - the `tg_*` cleanup inventory

  None is to be loosened; each new table, Lane and route is classified.
- **Frontend, the journey.** A Playwright spec over the mocked API on the Summary tab and History:
  - a Failed Summary shows its error and folded history
  - Retry on another Key and model streams text, then shows the report
  - a cut Attempt's Partial response can be kept, dismissed and restored
  - the countdown can be cancelled
  - Stop ends a running Attempt
  - a `limit` failure leads with Change selection
  - History's Failed filter shows only red cards
  - a phone-sized viewport has no sideways scroll

  Mocks are updated wherever a response shape changes.
- **Frontend, the logic below it.** Render tests for each new branching component (failure page, Partial responses list, running-Attempt card, size warning, History card states), as the CRAP ratchet requires. Unit tests for the size estimate and thresholds. Prior art: `PublishPanel.test.tsx`, `SummaryBody.test.tsx`, `ArtifactCard.test.tsx`, `ModelCombo.test.tsx`.
- **Mutation-test each new guard and each new test** before trusting it, as the repo's guide asks.

## Out of Scope

- Tag runs. They can be Pending and can fail too, but they follow later; the terms are chosen so they can join without a rename.
- "Continue from a Partial response" (asking the model to carry on from where it stopped).
- A per-account fallback list of Keys and models that the automatic retry walks.
- Plain-language explanations per error kind above the raw error. The kind is stored so this can follow.
- Defaulting the retry to a different working Key after a quota or auth failure.
- Collapsing repeated identical errors in the Attempt list.
- Spend totals per Attempt. The AI logs keep tokens.
- Notifications when an Attempt finishes.
- Pasting in the page instead of the dialog (tried as variant E and dropped).

## Further Notes

- The prototype stored Attempts in a local SQLite file behind a throwaway API and stubbed every run. None of its code is to be promoted. The real build rewrites the page in production code and adds the backend from scratch.
- `CONTEXT.md`, ADR-030 and this spec are not committed yet. They go to `main` together in one docs PR, branched from `origin/main`, not on the prototype branch.
- The prototype branch's history is clean of deployment names. If it is to be kept as a reference, push it as a sanitized snapshot per the prototyping guide and link it from the first ticket.
- Tickets, in `issues/`: SFR-01 Failed Summaries keep their reason (no blockers); SFR-02
  Attempts run on the worker (after 01); SFR-03 Recovering from failures and SFR-04 Retry on any
  Key and model (both after 02, and independent of each other).
