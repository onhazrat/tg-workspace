# TGU-01: Last sync and Last post on the Channels tab

**What to build:** The Channels tab says what its timestamps mean and shows when each Channel last posted. "Last updated" becomes **Last sync** in the Sort and the Time filter, and a Channel created by its first Follow has no Last sync until a sync finishes. **Last post** arrives as a Sort, a Time filter moment, a line on every Channel card, and a "No post in 30 days" preset at the top of the Filters menu; the Directory's last-Post moment and column take the same name. Spec: "Last sync and Last post" under Implementation Decisions, user stories 37 to 43.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Creating a Channel on its first Follow no longer sets its Last sync; its first regular sync is scheduled from the Follow's moment, so it still syncs on time. Channels created before this keep the value they have.
- [ ] A Channel with no Last sync sorts last by Last sync and fails every Time bound on it, as the Condition entry says; its card still reads "Never synced".
- [ ] The Sort option and the Time filter moment read "Last sync", with the description "When its most recent sync finished."
- [ ] The channel stats answer carries `lastPostAt`: the newest of the Post timestamps the route already reads per Channel, `null` with no stored Post, with no extra query. The generated client is regenerated.
- [ ] A "Last post" Sort option, and a "Last post" Time filter moment read from the stats (a Channel without one fails every bound on it and matches "none").
- [ ] Every card size shows "Last post 3d ago" under its sync line once the stats have loaded, and nothing for a Channel with no Last post.
- [ ] The Filters menu opens with a Presets section holding "No post in 30 days": it adds an OR of a Last post Time bound ending 30 days ago and Last post = none, joined to the rest of the filter with AND, and it round-trips through the URL.
- [ ] The Directory's last-Post moment and column are labelled "Last post".
- [ ] Tests at the API seam: a first Follow leaves the new Channel with no Last sync and a scheduled first sync; `lastPostAt` is the newest stored Post and `null` with none. Pure-module cases: the Last post Sort, the Last post moment, and the preset's filter printing and parsing. Each mutation-checked, named in the commit body.
- [ ] Lint, typecheck, the route guards and the full backend and frontend suites pass.
