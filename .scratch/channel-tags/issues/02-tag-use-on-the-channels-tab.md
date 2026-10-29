# TGU-02: Tag use, end to end on the Channels tab

**What to build:** The Channels tab lists its Tags in order of the Account's Tag uses on that tab, kept on the server, and its Tags dropdown can rename and delete. Using a Tag (selecting it, filtering by it from any control, putting it on or taking it off Channels by hand) records a Tag use; the order shows the next time a list opens and holds while it is open. A rename onto another Tag's name asks first; delete asks with the channel count. This is ADR-042 working on one tab, and the routes the other tabs reuse. Spec: "Tag use", "Routes" and "The shared dropdown", user stories 2, 3, 12 to 29.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] A per-Account Tag use table (Account, tab, Tag key, moment), owned by the Tags aggregate as its companion table, `USER_OWNED` in the tenancy seam, with its Alembic revision. The tab is one of `channels`, `directory`, `requests`.
- [x] A write route records one Tag use for a tab and Tag name, keeping at most the 50 newest per Account, tab and Tag. It is refused in a View-as session by the existing rule.
- [x] One read route answers, per Tag the Account has on a tab: its Tag use score (each use 1, halving every 14 days), its last use, and, when given a scope and a selection of handles, its channels in scope and how many are selected, in one statement. Setting groups' `group:` names are not in it. Reading is allowed in View-as (added to the read-only inventory if it is not a GET). Response models in the Tags schemas; the route inventories updated.
- [x] Renaming a Tag moves its uses to the new key on every tab in the same write; a merge adds them to the target's. Deleting a Tag, or untagging its last Channel, deletes its uses in the same write. A Tag run records none.
- [x] `FacetMenu` gains per-row rename and delete (icons that brighten on hover; none on derived rows), a delete confirmation naming the channel count, a merge confirmation shown only when the new name is another Tag's (not a case-only change) and renaming only on confirm, a per-row action slot between the name and the count, and an option to hold the row order from open to close.
- [x] The Channels tab's Tags dropdown uses them, its rows ordered by score, then channel count, then name. The bulk bar's Tag field and the filter row's Tag options follow the same order. A tick, a filter (dropdown, card Tag chip, filter row), and bulk tagging or untagging record a use; nothing records while viewing as someone.
- [x] API seam tests: recording and reading per tab, the decay with a frozen clock, the 50-use cap, rename and merge carrying uses, delete and last untag ending them, View-as refusing to record and allowing the read, the read's counts against a scope and a selection, and one Account never seeing another's uses. Component seam tests on `FacetMenu`: order held while open and changed on reopen, rename with and without a merge, delete confirming, no rename or delete on Untagged. Each mutation-checked, named in the commit body.
- [x] Lint, typecheck, the route guards, the tenancy and isolation guards and the full backend and frontend suites pass.
