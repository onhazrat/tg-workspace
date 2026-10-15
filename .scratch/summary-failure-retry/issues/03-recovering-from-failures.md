# SFR-03: Recovering from failures

**What to build:** A failure costs as little as possible. Text a cut-off or stopped Attempt produced is kept as a **Partial response** that can be used, set aside or brought back; a passing overload is retried once by itself; and scheduled regenerations record their Attempts, so an unattended failure shows up in History and never stalls the chain.

Spec: `.scratch/summary-failure-retry/spec.md`. Terms: **Partial response**, **Incomplete** in `CONTEXT.md`; ADR-030.

**Blocked by:** SFR-02.

**Status:** resolved

- [ ] The failure page lists every Partial response, newest first, each with its attempt number, model, length and time, a short preview with Show all, Keep this draft (primary on the newest only) and Dismiss; dismissed ones sit in a "Dismissed (n)" fold with Restore.
- [ ] Keep finishes the Summary with that text, marks it **Incomplete** with a visible mark where the text stops, records a `kept_partial` Attempt and gives the Summary that Attempt's model and AI Key. An Incomplete Summary can still be retried.
- [ ] Dismiss and Restore set and clear the dismissed time without deleting text; a dismissed Partial response's text is cleared after a deployment-set number of days.
- [ ] A Publication of an Incomplete Summary made by hand ends its last Part with a line saying where the text stops.
- [ ] The worker re-queues a `transient` failure once, after the Provider's Retry-After or ten seconds; an automatic Attempt, a stopped Attempt, and quota, auth, model, limit and empty failures are never retried automatically. The page shows the countdown with Cancel, which withdraws the queued retry.
- [ ] A scheduled regeneration creates its successor Summary first and runs as an Attempt on the generation Lane (flagged `scheduled`). A failed tick leaves that successor Failed and hands it auto-regenerate, so the next tick derives the following window from it; a quota failure still switches auto-regenerate off.
- [ ] Scheduled auto-publish skips an Incomplete Summary and files a skipped publish log row.
- [ ] Keep, Dismiss and Restore need an elevation in View-as and stamp the acting Owner.
- [ ] Backend tests over HTTP with the Lane drained by hand and a fake Provider: a cut Attempt's Partial response, Keep making the Summary Incomplete, Dismiss/Restore round-trip and the trim, exactly one automatic retry after a 503 and none after a 429, Cancel withdrawing it, a failed scheduled tick carrying the chain, and auto-publish skipping an Incomplete Summary. Guards met, none loosened: retention inventories (the trim declared), View-as mutation inventory, publish scoping, account isolation.
- [ ] Frontend: render tests for the Partial responses list and the countdown, and the Playwright journey covering keep, dismiss, restore and cancelling the countdown, at desktop and phone widths.
