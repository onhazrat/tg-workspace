# SUMTAB-10: Partial Publications

**What to build:** A Publication that fails partway stops at the failed Part, keeps the Parts already
sent, and is recorded as partial with how many went out and why it stopped, for manual and scheduled
sends alike. The Summary's publish panel then says "Last Publication was partial: 2 of 5 Parts sent"
and offers "Send the remaining 3", which sends exactly the stored remaining Parts, never re-planned
text and never a Part already delivered. The scheduler records partial Publications but never
finishes one itself. See `.scratch/summary-tab/spec.md`, user stories 69-71, and "Publications
(backend)" under Implementation Decisions.

**Blocked by:** SUMTAB-09 (the Publication routes and the publish panel).

**Status:** ready-for-agent

- [ ] A send stops at the first failed Part; the publish-log row records sent and total Parts and the failure
- [ ] The Publication route, given a partial Publication's id, sends only its remaining stored Parts and updates the same row
- [ ] The scheduler records a partial Publication the same way and does not resume it
- [ ] The panel shows the latest partial Publication of the Summary with "Send the remaining K"
- [ ] Route-level tests cover a failure at Part 3 of 5, resuming exactly Parts 3 to 5, and refusing to resume another Account's Publication
- [ ] The scheduler test covers a partial scheduled Publication left for a person to finish
