# DIR-02: Browse the Directory

**What to build:** The tracer bullet. An Account opens a new Directory tab and sees the
Directory's live Channels it does not follow and can follow, ranked by how many of its channels
cite them. It narrows the list with a Directory filter from a bar built like the Channels and Posts
tabs' bars, sorts and pages it, hides columns, follows one Channel or many, and shares or bookmarks
the view by its URL. See `.scratch/directory-tab/spec.md`: user stories 1 to 14, the table half of
20, 15 to 19 (19's columns arrive with DIR-07), 35 to 42, 43 (Hide followed and Followable only),
44 to 51, 54, 55 (Followed and Followable), 56 to 69, 82 to 90 (Follow and Clear in the bulk bar),
97 to 99, 111, the Follow half of 112, 113 and 114, and the implementation decisions on the
Directory filter, Conditions, Reference kinds, "Your channels", "Cited by your channels", the
opening view, the read endpoint family, picking the page first, Follow from the Directory, the tab,
state, the filter's text form and columns.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

The prototype's variant T (branch `prototype/directory-tab-bars`) shows the bar to rebuild, on top
of variant E's table and bulk bar (`prototype/directory-tab`); rewrite it properly rather than
copying its code. It ran against a throwaway API with no guards. The Conditions here are those that
read the Directory entry alone plus "Cited by your channels", which is counted live from the
References. The search box comes in DIR-04, the detail panel in DIR-03, citation counts in DIR-05,
Dismissal and the Hide dismissed switch in DIR-06, and Shared parents and Shared children in
DIR-07.

### The Directory filter

- [x] A Directory filter is a tree of Conditions on the shared filter tree (AND, OR, NOT, parentheses) with its own closed vocabulary, a text form in the shared grammar (the spec's prototype snippet) that parses and prints back unchanged, and bounds on depth and size like the Post filter's
- [x] The browser sends the tree; only the server evaluates it, compiling each Condition to one boolean expression and joining them as the tree says; an empty group passes everything, negated or not
- [x] Conditions: Language; Name contains (case-insensitive, any part of the handle or the display name); bounds (at least, at most, between, no value) on subscribers, Reach, posts per week, forwarded share, days since last post, days since the Directory found it, photos, videos, files and links; Followed; Followable (the entry's followability verdict); Cited by your channels, with an optional window in days. Every Condition can be negated, and an entry with no value fails every bound on that number. There is no "has a profile photo" Condition
- [x] One view-level Reference kinds setting (forward, mention, link, reply; none means every kind) narrows "Cited by your channels", the "Yours" count and its sort; it is not a field on any Condition

### Your channels

- [x] "Your channels" is a view setting with three values: every Channel the Account follows, its Channels tab selection (the Hidden selection included; not the Scope, so the Analysis window and Post selection do not apply), or the Channels ticked in the Directory list
- [x] The sort picker offers "Cited by channels you follow", "Cited by your Channels tab selection" and "Cited by channels ticked here"; choosing one sets the view's value, and the "Yours" column, the "Cited by your channels" Condition, the "days since your channels last cited it" sort and discovered-via all read the same value
- [x] It counts distinct channels of the chosen set whose Posts make a Reference to the Channel, over all time unless the Condition sets a window; the browser sends the selection's or the ticks' handles, or a flag for every follow that the server resolves from the Account's Follows
- [x] "Channels ticked here" follows the ticks as they change
- [x] A view with no stored value starts on the selection when the Channels tab has one and on every follow otherwise; a value chosen explicitly is never swapped, so an empty selection or tick list counts 0 for every row and the footer says so
- [x] The opening view is `not followed and followable`, sorted by "Cited by your channels", highest first. DIR-06 adds `not dismissed` to it

### The read endpoint family

- [x] A list operation takes the filter, the sort and direction, the page (100 rows), the "your channels" value with what it needs and the Reference kinds, and returns a light list: each row's measures, the your-channels count and its latest time, the Followed flag. Never the bio or samples
- [ ] It returns the total and the Language counts for the view without its Language Conditions; when no Condition beyond the opening view's three (Followed, Dismissed, Followable) and no search is on, the total is an estimate and is marked so, otherwise exact; totals and Language counts are cached per Account and view for a few minutes and reused across sort and page changes
- [x] A count operation returns the whole Directory's size, for the filter row's "of M", cached
- [x] The page is chosen from the Directory entry first and joined to the your-channels count only when a Condition or the sort reads it
- [x] A distribution operation returns a measure's spread for the bound editor (log scale where the measure calls for it, median, how many have no value) under every other Condition, and a count-only operation previews how many a candidate Condition leaves
- [x] The list operation is a POST and is declared read-only in View-as's inventory; every route has a closed response model, the approval gate and the auth dependency, and reaches the frontend through the generated client
- [x] Reach is labelled and described as the glossary's Reach, the median Settled View count of recent Posts, shown as an estimate when it is one

### The tab

- [x] A Directory tab in the workspace, a Closable tab open at most once
- [x] The bar is laid out like the Posts tab's and built from the shared components, with no Directory-only copies: a pill row, then the shared filter row, then a footer. DIR-04 puts the search box above the pill row
- [x] The pill row: the shared facet menu for Language (names, per-Language counts, funnels joined with OR, no tick column; its pill names a lone funnelled Language); a Filters pill opening the shared condition picker, grouped as Channel, Size and activity, Content and References, with a count of the Conditions on; the Channels tab's on/off switches for Hide followed and Followable only; a Reference kinds pill; a divider; the shared sort picker with its direction arrow; and a Columns pill at the end
- [x] Every dropdown in the bar opens on a search box: Language, Filters, Reference kinds, Sort and Columns
- [x] A switch is on only when its Condition sits on the filter's top-level AND; turning it on or off adds or removes that Condition, wrapping the filter in a new AND first when its top level is an OR, so the switches and the chips never disagree
- [x] The bound editor: the histogram, median, the four modes, day presets of 1, 7, 30, 90 and 365, a note of how many have no value, a click on a bar setting the bound, and a live count preview on its Add button; negation is the chip's NOT, not a box in the editor
- [x] The shared filter row: "N of M" (M the Directory's size), every Condition as a chip that reopens its editor, NOT on any chip, AND and OR joiners that switch, parentheses, drag one chip onto another to group, and Clear all
- [x] The footer: the count, how long the list took, the empty "your channels" notice, and the Directory's size
- [x] Column headers sort; measures counted in days start newest first
- [x] The table shows the columns of user story 7 except Cited by and Cites, which DIR-05 adds, with right-to-left text laid out right to left, previous and next pages, and the total
- [x] Each row's handle is a link to Telegram's public web view, styled and opened in a new tab as Discover's are; clicking it does not open the panel (DIR-03), clicking the rest of the row does
- [x] The Columns menu hides any column but the Channel and the actions, searching each column's name and description; the choice is per browser and Account and survives clearing the filter
- [x] On a narrow screen the table keeps the Channel, one chosen measure and Follow

### Follow and ticks

- [x] Follow on a row runs the existing follow job and records as discovered-via the newest Reference from the chosen "your channels" to that Channel, when one exists
- [x] Rows have checkboxes and the header ticks every unfollowed Channel on the page, with a partial state; followed Channels show checked and locked; ticks survive paging and filter changes and live in the tab's shared view state, where "your channels" (and DIR-07's picks) can read them
- [x] A bulk bar shows the count, a few handles, Follow and Clear; following five or more asks for confirmation first, from Discover's existing threshold

### State

- [x] The filter, the sort and direction, the "your channels" value, the Reference kinds and the page live in the URL: the filter as one parameter in the shared text form, the rest beside it; opening a shared link shows exactly that view
- [x] The last view is remembered per Account through the scoped storage, and a tab opened without them adopts it
- [x] The ticks are per browser and never in the URL

### Tests and guards

- [x] The Directory HTTP test module, with two live Accounts (each with Follows and a selection) over a small shared corpus laid out in a table at its top, covers every Condition, negation and nesting (including an OR holding one of the opening view's Conditions), Name contains, the opening view, the three "your channels" values and an empty source counting 0, Reference kinds narrowing the "Yours" count, every sort, estimated and exact totals, the Directory's size, Language counts, the distribution and count operations, and View-as browsing; it lists the mutations it was watched to fail on
- [x] The Directory filter's text form has parse and print round-trip tests for every Condition, including malformed input and an unknown `is:`
- [x] Component render tests for the bound editor, the switch row, the bulk bar and every other new branching component, as the CRAP ratchet requires; test files type-check
- [x] A mocked Playwright journey: open the tab, funnel a Language, turn a switch off and on and see its chip come and go, add a bound through the Filters picker, search the Sort, Reference kinds and Columns dropdowns, choose "Cited by channels ticked here", see the URL change and survive a reload, open a shared link, tick rows and confirm a bulk follow of five, and check a row's handle is a Telegram web view link
- [x] The route inventory, route module hygiene, account isolation, approval gate, View-as inventory and service-kind guards pass with the new routes and read model in them, each watched to fail once

## Comments

2026-10-06, DIR-02 backend (branch `dir/dir-02-backend`): ticked only boxes the
backend meets on its own. Shapes, routes and client functions for the frontend
half are in the implementer notes (`DIR-02-backend.md`).

- **Totals are exact, never estimated, so "the total is an estimate and is
  marked so" is left open on purpose.** The Language counts are one GROUP BY
  over the view without its Language Conditions; with no Language Condition on,
  their sum is the exact total, so an estimate saves nothing. On the staging
  copy (297K listed entries) the opening view takes 0.36 s cold with both, and
  the 5-minute per-Account cache covers sort and page changes. The response has
  no estimated flag. If the lead still wants an estimate, it is the opening
  view's `M - follows`, one branch in `directory_reads._totals`.
  The test module therefore covers exact totals only.
- The filter's text form (parse and print) is the frontend's: the shared
  grammar lives only in `frontend/src/lib/filter-text.ts`. The first box stays
  open for that half; the tree, its closed vocabulary and the bounds are done.
- Follow with discovered-via: no new route. `POST /data/channels/bulk-follow`
  takes an optional `directory: {yours, referenceKinds}` and fills each missing
  `discoveredVia` server-side with the newest Reference from that set. The box
  stays open until the row's Follow button sends it.
- Reach: the row's `reach`/`reachEstimated` carry the glossary's description in
  the client; the label in the tab is the frontend's.
- "Your channels" defaults, the three sort choices and the opening view are UI
  state; the server takes any value and has no default view of its own beyond
  `yours.source = "follows"` and `sort = "mine"`.

2026-10-06, DIR-02 frontend (branch `dir/dir-02-frontend`): every box but the
estimate is ticked.

- **The estimate box stays open by the lead's decision:** totals are always
  exact (0.36 s cold on the staging copy), so the footer shows the number as
  is and there is no estimate mark to render.
- Clicking a row opens nothing yet. The handle is its own link that stops the
  click, so DIR-03's row click cannot take it; the panel itself is DIR-03's.
- "One chosen measure" on a narrow screen is the sorted one: below `md` the
  table keeps the Channel, the column the sort reads and Follow, so the sort
  picker is how the Account chooses it. A separate chooser was not built.
- The view's URL parameters are `dirFilter` (text form, always written, so a
  copied link never adopts somebody's remembered view; `?dirFilter=` is the
  empty filter), `dirSort`, `dirOrder`, `dirYours`, `dirKinds`, `dirPage`.
  The ticks and the hidden columns are in scoped storage, never the URL.
- The bound editor's count preview ANDs the candidate onto the filter with
  that measure's other bounds taken out; inside an OR it is approximate, as
  the spec's Further Notes say.
- Playwright journey: `frontend/tests/directory.spec.ts`, run with
  `PLAYWRIGHT_API_URL`, workers=1, against a native backend on a private
  database (only login is real; every Directory route and bulk follow is
  mocked). It lists the mutations it was watched to fail on.
