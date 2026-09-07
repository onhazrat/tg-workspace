# 04: The Spend Meter

**What to build:** An Operator can see what the probe sweep is spending and whether the harvest is
running, so that a rate-limited Request budget stops being invisible.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The probe bar shows Requests spent today and this week
- [ ] The probe bar shows whether the harvest is enabled and whether it is currently running
- [ ] Attempts, last error and retry state appear on no user-facing surface
- [ ] No new route and no new screen

## Why this is the only probe machinery worth a pixel

The deployment spends a rate-limited Request budget on the probe lane continuously and nothing
displays it. The numbers have been on the queue route since the harvest shipped; the hand-written
client type simply omits them, so nothing renders them. This ticket is mostly widening a type.

Everything else about the probe is the deployment's business and not the reader's. A Candidate row
is about a Channel. A scraping error is about the deployment's attempts to reach one, and putting
that in front of a User makes the tab read as a job console.

## Notes

Independent of the other three and grabbable at any point. It is last only because it is smallest.

The queue projection test's expected key set grows to cover the four fields.
