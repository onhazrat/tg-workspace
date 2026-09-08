# 04: The Spend Meter

**What to build:** An Operator can see what the probe sweep is spending and whether the harvest is
running, so that a rate-limited Request budget stops being invisible.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The probe bar shows Requests spent today and this week
- [x] The probe bar shows whether the harvest is enabled and whether it is currently running
- [x] **Spend is visible while the queue is idle**, which is when an Operator is most likely to be
      asking what the sweep cost
- [x] **The figures refresh while the queue is idle**, or they are stale every time they are read
- [x] **The spend figures and the pause control render only for an account that may manage jobs**,
      since both are deployment telemetry and the pause is already gated server-side
- [x] An account without that permission sees the bar exactly as it behaves today: progress while
      the queue is draining, and nothing when it is idle
- [x] Tests cover the idle case and the non-permitted account case specifically
- [x] Attempts, last error and retry state appear on no user-facing surface
- [x] No new route and no new screen

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

## Who sees it

The queue route authenticates the caller and asks nothing else, so every signed-in account can
read deployment-wide probe counts today. That is tolerable while the bar only appears during a
drain, because what it shows is progress on work the reader is plausibly waiting for. It stops
being tolerable when the bar is permanent and carries a spend total, which is a fact about the
deployment's budget and no business of an ordinary account.

So the spend figures render only for an account that may manage jobs. Everyone else keeps exactly
today's bar: progress while draining, nothing when idle.

**This also fixes a bug that predates the ticket.** The pause control is rendered for every
account, and the toggle it drives requires the job-management permission server-side, so an
ordinary account is currently shown a button that answers 403. Nobody noticed because the bar is
usually absent. Making the bar permanent would make that permanent too, so the gate has to cover
the control as well as the figures.

Gating the display rather than the route is deliberate: the counts stay readable by anyone, which
is today's behaviour and not this ticket's to change.

## Why this is the only probe machinery worth a pixel

The deployment spends a rate-limited Request budget on the probe lane continuously and nothing
displays it.

Everything else about the probe is the deployment's business and not the reader's. A Candidate row
is about a Channel. A scraping error is about the deployment's attempts to reach one, and putting
that in front of a User makes the tab read as a job console.

## Notes

Independent of the other three and grabbable at any point.

The queue projection test's expected key set grows to cover the four fields.
