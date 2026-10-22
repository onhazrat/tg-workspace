# RQS-19: Remove the leftover endpoints

**What to build:** Follow-up, not part of the spec's build. `/telegram/scrape` and `/telegram/resolve-start-time` have no frontend callers left but still make Requests.

**Blocked by:** None (can start immediately)

**Status:** needs-triage

- [ ] Both routes, their services where unused elsewhere, and their tests are removed.
- [ ] The route inventories and the generated client are updated.
