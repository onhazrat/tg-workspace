# RQS-17: Stop retrying answered errors

**What to build:** Follow-up, not part of the spec's build. A 404 is retried eight times, each attempt charged, up to 32 inside a sync page. Land it after recording has run on a deployment, so the Requests tab shows the waste before and after.

**Blocked by:** RQS-01 (and recording live long enough to measure the before)

**Status:** needs-triage

- [ ] Answered errors (404, 410, 400, 451) are not retried by `fetch_with_retry` or the page's outer retry.
- [ ] The quota ledger tests are updated deliberately, with the reasoning in their docstrings.
