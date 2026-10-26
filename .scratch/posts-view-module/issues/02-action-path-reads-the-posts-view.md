# PVM-02: The Action path reads the Posts view

**What to build:** Everything an Action asks of the Posts tab is a plain
function of the Posts view, and an Account sees no difference. The Scope a
Summary, Chat, Tag run or Discovery report submits for the server to freeze is
built from the Posts view and the Channels it names, sending the canonical
window as today. The fetch for what the tab shows, shown or ranked by a meaning
search or a find-related, is a function of the Posts view and the api it
calls; the command registry and the feed's meaning-search path call it.

The "no Posts selected" check before Generate and copy prompt becomes the
view's Scope counts: a Posts read whose key and body come from the same
function as every other Posts read's, fetched with no stale time so a selection
changed a moment ago is counted. The browser's hand-made prompt Scope type, the
prompt-posts input, its counting helper and the hook that assembled the Action
path from loose values all go. The count request's body loses the views
measure, the sort and the grouping, which a count ignores; its route and answer
do not change.

**Blocked by:** PVM-01.

**Status:** ready-for-agent

- [x] The Scope submission is tested with a Posts view literal: the Channels, the canonical window (a Live window stays Live), the order and the selection body, field by field.
- [x] The fetch for what the tab shows is tested with a view literal and a fake api: the shown read, a meaning search with and without respecting the Channels, and a find-related.
- [x] The Posts view tests grow a case for the Scope counts read used by the check, pinning its key and body.
- [x] Generate and copy prompt with no Posts selected still refuse with the same message, and a selection changed just before is read fresh; covered at the AI context's existing seam.
- [x] No module names the prompt-posts input, the browser's prompt Scope type or the removed hook.
- [ ] The full Playwright suite passes, run serially; only a mock that asserts the count request's body changes, if any does.
- [ ] Typecheck (build and tests), biome and `bun test src` pass; the CRAP ratchet holds.
