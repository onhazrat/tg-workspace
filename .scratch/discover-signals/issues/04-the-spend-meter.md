# 04: The Spend Meter

**What to build:** An Operator can see what the probe sweep is spending and whether the harvest is
running, so that a rate-limited Request budget stops being invisible.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The probe bar shows Requests spent today and this week
- [ ] The probe bar shows whether the harvest is enabled and whether it is currently running
- [ ] **Spend is visible while the queue is idle**, which is when an Operator is most likely to be
      asking what the sweep cost
- [ ] **The figures refresh while the queue is idle**, or they are stale every time they are read
- [ ] A component or hook test covers the idle case specifically
- [ ] Attempts, last error and retry state appear on no user-facing surface
- [ ] No new route and no new screen

## This is not just widening a type

The numbers have been on the queue route since the harvest shipped and the hand-written client type
omits them, so the type does need widening. That is the easy half and it is not the whole ticket.

Two existing behaviours would make a spend meter useless as it stands. The bar **returns null**
unless something is queued, running or retrying, so it disappears entirely on an idle queue. And
the poll predicate returns false unless the queue is enabled and actually draining, so even a
visible bar would hold whatever figure it last saw.

Both are correct for what the bar does today, which is report on work in flight. A spend meter is
the opposite kind of thing: a budget total is most worth reading when nothing is running, because
that is when the question is "what did the sweep cost me", not "is it moving". So the ticket has to
change when the bar renders and when its data refreshes, and the reason those conditions exist
(documented in both files) has to survive the change rather than be deleted.

Refresh cadence when idle should be slow. A daily and weekly total does not need a fifteen-second
poll, and the existing predicate's own docstring makes the argument for not polling to watch
something that changes a few times a day.

## Why this is the only probe machinery worth a pixel

The deployment spends a rate-limited Request budget on the probe lane continuously and nothing
displays it.

Everything else about the probe is the deployment's business and not the reader's. A Candidate row
is about a Channel. A scraping error is about the deployment's attempts to reach one, and putting
that in front of a User makes the tab read as a job console.

## Notes

Independent of the other three and grabbable at any point.

The queue projection test's expected key set grows to cover the four fields.
