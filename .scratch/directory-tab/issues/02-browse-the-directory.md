# DIR-02: Browse the Directory

**What to build:** The tracer bullet. An Account opens a new Directory tab and sees the
Directory's live Channels it does not follow and can follow, ranked by how many of its selected
Channels cite them. It narrows the list with a Directory filter, sorts and pages it, hides columns,
follows one Channel or many, and shares or bookmarks the view by its URL. See
`.scratch/directory-tab/spec.md`: user stories 1 to 15, the table half of 17, 31 to 43, 47 (Followed
and Followable), 48 to 56, 69 to 77 (Follow and Clear in the bulk bar), 84 to 86, 95, the Follow half
of 96, 97 and 98,
and the implementation decisions on the Directory filter, Conditions, the opening view, "Cited by
the selected Channels", the read endpoint family, picking the page first, Follow from the
Directory, the tab, and state.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

The prototype's variant E (branch `claude/find-e-signals`) shows the behaviour to rebuild; rewrite
it properly rather than copying its code. It ran against a throwaway API with no guards. The
Conditions here are those that read the Directory entry alone plus "cited by the selected
Channels", which is counted live from the References. The search box comes in DIR-04, the detail
panel in DIR-03, and citation counts and Dismissal in DIR-05 and DIR-06.

### The Directory filter

- [ ] A Directory filter is a tree of Conditions on the shared filter tree (AND, OR, NOT, parentheses) with its own closed vocabulary, a text form in the shared grammar that parses and prints back unchanged, and bounds on depth and size like the Post filter's
- [ ] The browser sends the tree; only the server evaluates it, compiling each Condition to SQL as the Post filter does
- [ ] Conditions: Language; bounds (at least, at most, between, no value) on subscribers, Reach, posts per week, forwarded share, days since last post, days since the Directory found it, photos, videos, files and links; has a profile photo; Followed; Followable (the entry's followability verdict); cited by the selected Channels, as a count with an optional window in days. Every Condition can be negated, and an entry with no value fails every bound on that number
- [ ] "Cited by the selected Channels" counts distinct selected Channels, the Hidden selection included, whose Posts make a Reference to the Channel, over all time unless the window is set; it is not the Scope, so the Analysis window and Post selection do not apply
- [ ] The opening view is `not followed and followable`, sorted by "cited by the selected Channels"; with no Channels selected it sorts by Reach and says how to get the personal ranking. DIR-06 adds `not dismissed` to it

### The read endpoint family

- [ ] A list operation takes the filter, the sort and direction, the page (100 rows) and the selected Channels, and returns a light list: each row's measures, the selected-Channels count and its latest time, the Followed flag. Never the bio or samples
- [ ] It returns the total and the Language counts for the view without its Language Condition; when no Condition beyond the opening view's three (Followed, Dismissed, Followable) and no search is on, the total is an estimate and is marked so, otherwise exact; totals and Language counts are cached per Account and view for a few minutes and reused across sort and page changes
- [ ] The page is chosen from the Directory entry first and joined to the selected-Channels count only when a Condition or the sort reads it
- [ ] A distribution operation returns a measure's spread for the bound editor (log scale where the measure calls for it, median, how many have no value) under every other Condition, and a count-only operation previews how many a candidate Condition leaves
- [ ] The list operation is a POST and is declared read-only in View-as's inventory; every route has a closed response model, the approval gate and the auth dependency, and reaches the frontend through the generated client
- [ ] Reach is labelled and described as the glossary's Reach, the median Settled View count of recent Posts, shown as an estimate when it is one

### The tab

- [ ] A Directory tab in the workspace, a Closable tab open at most once
- [ ] The filter bar: facet buttons with a count of active Conditions; a Language menu with names, per-Language counts, include, exclude and "only"; one searchable Filters list of every Condition; a bound editor with the histogram, median, the four modes, negation, day presets of 1, 7, 30, 90 and 365, a note of how many have no value, a click on a bar setting the bound, and a live count preview on its Add button; chips that reopen their editor; clear all
- [ ] A sort picker with direction; column headers sort; measures counted in days start newest first
- [ ] The table shows the columns of user story 7 except Cited by and Cites, which DIR-05 adds, with right-to-left text laid out right to left, previous and next pages, and the total
- [ ] A Columns menu hides any column but the Channel and the actions; the choice is per browser and Account and survives clearing the filter
- [ ] On a narrow screen the table keeps the Channel, one chosen measure and Follow

### Follow

- [ ] Follow on a row runs the existing follow job and records as discovered-via the newest Reference from the selected Channels to that Channel, when one exists
- [ ] Rows have checkboxes and the header picks every unfollowed Channel on the page, with a partial state; followed Channels show checked and locked; picks survive paging and filter changes
- [ ] A bulk bar shows the count, a few handles, Follow and Clear; following five or more asks for confirmation first, from Discover's existing threshold

### State

- [ ] The filter, sort and page live in the URL as one Directory filter parameter in the shared text form plus sort parameters; opening a shared link shows exactly that view
- [ ] The last view is remembered per Account through the scoped storage, and a tab opened without them adopts it

### Tests and guards

- [ ] The Directory HTTP test module, with two live Accounts (each with Follows and a selection) over a small shared corpus laid out in a table at its top, covers every Condition, negation and nesting, the opening view, the Reach fallback, every sort, estimated and exact totals, Language counts, the distribution and count operations, and View-as browsing; it lists the mutations it was watched to fail on
- [ ] The Directory filter's text form has parse and print round-trip tests, including malformed input
- [ ] Component render tests for the bound editor, the bulk bar and every other new branching component, as the CRAP ratchet requires; test files type-check
- [ ] A mocked Playwright journey: open the tab, add Conditions through the picker, see the URL change and survive a reload, open a shared link, pick rows and confirm a bulk follow of five
- [ ] The route inventory, route module hygiene, account isolation, approval gate, View-as inventory and service-kind guards pass with the new routes and read model in them, each watched to fail once
