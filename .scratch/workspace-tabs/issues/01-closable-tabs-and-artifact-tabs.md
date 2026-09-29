# TABS-01: Closable tabs and one tab per Artifact

**What to build:** The workspace tabs behave like browser tabs. Channels, Posts and Action are Fixed
tabs. History, Settings and the Artifact tabs are Closable tabs with a close button, middle-click
close, and a "+" menu to open them again. Every Summary, Chat session, Tag run and Discover report
opens in its own Artifact tab, opening one that already has a tab switches to it, and a tab opened
with "+" starts empty. The open set is remembered per device and per account. A new account starts
with the Fixed tabs only, and History appears once it has an Artifact. See
`.scratch/workspace-tabs/spec.md`, user stories 1-32, 43-56, and every implementation decision
except reordering and overflow.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

### Tab-set model

- [ ] One pure tab-set model with no React and no storage replaces the visible-tabs helper. Its operations are open (kind, optional Artifact id), create, close, focus, reconcile and reopen-last
- [ ] A tab is identified by its kind plus Artifact id, or its kind alone when empty. There are never two tabs for one Artifact and never two empty tabs of one kind
- [ ] Open focuses an existing tab for that Artifact, or that kind's empty tab, before it appends a new one at the end
- [ ] Create fills that kind's empty tab when one exists and appends a new tab otherwise
- [ ] Closing the active tab activates the tab to its right, or to its left when it was last. Fixed tabs cannot be closed
- [ ] Reconcile drops tabs whose Artifact is not in the account's Artifact list
- [ ] Reopen-last restores the most recently closed tab with its Artifact, walking an in-memory stack kept for this session
- [ ] The default set is derived: the Fixed tabs, plus History when the account has at least one Artifact and has not closed History. Settings starts closed

### Persistence and URL

- [ ] The ordered Closable tabs and a "History closed by you" flag live in `scopedStorage`. A storage error falls back to the default set
- [ ] `?tab=` plus the matching Artifact param name the active tab, and only the active tab's Artifact param is present. Switching tabs no longer carries an old `?summary=` (or any other Artifact param) forward
- [ ] A URL naming an Artifact that has no tab opens a tab for it. `?tab=settings` and `?section=` open Settings when it is closed
- [ ] A closed tab stays reachable by URL, so `?tab=` still validates against the unfiltered tab list

### Strip

- [ ] The tabs stay `<Link>`s in the labelled `<nav>` with `aria-current`
- [ ] Closable tabs show × on the active tab and on hover. Middle-click closes a Closable tab and prevents the browser's new-tab default. Middle-click on a Fixed tab still opens a browser tab
- [ ] A "+" button at the end of the strip lists the closable kinds, and picking one runs the model's open for that kind with no Artifact
- [ ] Artifact tab labels show the kind icon and a short name (scope and date for a Summary, first question for a Chat, a matching name for Tag and Discover), truncated, with the full text in a tooltip. An empty tab shows only its kind

### Artifact views and entry points

- [ ] The four Artifact views read their Artifact from the active tab and render the existing "go to Action" empty state when it has none
- [ ] Discover's "latest report" fallback and its "Show latest" button are gone. Discover's generate opens the new report in a tab
- [ ] Summary generate and paste, Tag run and paste, Discover generate and Chat start from Action all go through create. A Summary re-run stays in its tab
- [ ] "New conversation" in a Chat tab that holds a conversation goes through create and leaves that conversation in its tab
- [ ] Opening from History, the logs' "View summary" and the palette's summary search open the Artifact through the model. The last two no longer route to History
- [ ] Deleting an Artifact closes its tab. A stored tab whose Artifact is gone closes silently on load
- [ ] Closing a tab mid-run lets the run finish and save to History

### Palette and tour

- [ ] The palette gains "Close tab" and "Reopen closed tab"
- [ ] "Go to <kind>" focuses the most recently active tab of that kind, or opens an empty one
- [ ] The guided tour snapshots the tab set, opens the tabs it visits, and restores the snapshot when it ends or is dismissed

### Compact setting removal

- [ ] The `compactWorkspaceTabs` settings key, its catalog entry and the compact tab-id constant are deleted, along with the invariant-test cases that pinned them

### Tests

- [ ] Model unit tests pin every rule above (dedupe by Artifact, dedupe of empty tabs by kind, create fills or appends, close right then left, Fixed tabs not closable, reconcile, reopen-last walks the stack, default set with and without Artifacts and after a History close). These replace the visible-tabs tests
- [ ] One mocked Playwright spec: × and middle-click close; "+" opens an empty tab; two Summaries from History give two tabs; reopening an open Summary switches to it; a closed Summary tab reopened with "+" is empty; the tab set survives a reload; a deep link opens its Artifact. Run it with one worker
- [ ] Mutation-test the spec once: break the dedupe and watch it go red
- [ ] The existing Playwright specs that click `tour-tab-*` or land on an Artifact tab by URL still pass
- [ ] Frontend lint, typecheck and unit tests pass
