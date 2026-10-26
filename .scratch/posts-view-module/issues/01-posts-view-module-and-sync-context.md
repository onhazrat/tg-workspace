# PVM-01: The Posts view gets a module of its own, and the rest becomes the Sync context

**What to build:** The Posts tab's state (the keyword, the Post filter, the
ranking, the order and cap, the Post selection) moves out of the scraper
context into a Posts view module, and an Account sees no difference except
that typing and syncing stop re-rendering the workspace. The module's provider
builds the whole Posts view once, from its own state, the selected Channels
and the Analysis window, and offers it through three contexts split by how
often they change: the view, which moves on every edit; the edits, whose
identity never changes; and the typed keyword, read by the search box alone.
The edits are domain operations: set the keyword, set the Post filter, set the
ranking (none, a meaning query with whether it respects the Channels, or a
related Post, never two at once), set the order (sort, grouping, views measure,
cap and its mode as one value), the three selection edits, and restore, which
puts an Artifact's frozen Scope back in one edit and clears the ranking. A
Channel spotlight is still applied per surface, on top of the view.

What remains of the scraper context is renamed the Sync context and memoized:
sync jobs and Stop sync, the sync queue, the auto-sync pause, which Channels are
syncing, the restricted recheck, and the two Follow operations. Invalidating
the Posts reads becomes a plain function the Posts view module owns, which the
Sync context and the Live-window refresh call; the alias that only called it
goes. Every one of the 20 readers moves to the context it needs; the shell
stops reading the keyword; the command registry takes the Posts view and its
edits as two fields in place of 14 Posts fields.

The Action path (the Scope submission, the fetch for what the tab shows, the
prompt-posts input) keeps its current interface here and reads its inputs from
the new module; PVM-02 replaces it. The fetch for what the tab shows keeps one
identity across provider renders, which fixes the meaning search re-running on
every render: the hand-written dependency list that named an object rebuilt
every render goes.

Build order, keeping the unit suite green after each step: the provider-identity
test, red on main; the module and its three contexts with their provider tests;
readers moved one family at a time (the Posts tab, the restore, the command
registry, the AI, Chat and Tag contexts, the shell); the rename; the field-set
pins and the fan-out test last. Commit before mutating each guard.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] A provider test shows the edits and the fetch for what the tab shows keep their identity across a provider re-render; it fails against main and passes here.
- [x] Provider tests cover each edit: the keyword debounced once, the ranking exclusive, the order as one value, the three selection edits and the revision they move, restore replacing the keyword, the Post filter, the order and the selection and clearing the ranking.
- [x] Storage round-trips are tested: the Post filter in the URL, the order and cap under their existing per-Account keys with the legacy fallbacks, the selection for the browser session.
- [x] A fan-out test mounts a sync-only reader, an edits-only reader and the search box under the provider: a keystroke re-renders only the search box, and only view readers re-render when the debounce fires.
- [x] The architecture invariants pin the field sets of the Posts view contexts and the Sync context, and fail a Posts view field on the Sync context.
- [x] Each guard is mutation-checked (a Posts field added to the Sync context, the Sync context's memo dropped, the defective dependency restored) and each check is written into the commit body as `Mutation-checked: <what you broke> went red`.
- [x] No reader names the scraper context; the command registry's context has two Posts fields; the shell reads no keyword.
- [ ] The full Playwright suite passes with no spec edited, run serially.
- [x] Typecheck (build and tests), biome and `bun test src` pass; the CRAP ratchet holds.
