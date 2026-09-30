# CTB-01: The new bar, on the Channel filter

**What to build:** Today's five rows at the top of the Channels tab become two rows and a Channel
filter row, and every capability of the old bar survives. Groups, Tags and Languages become one
kind of dropdown with a search, a tick that selects a row, `selected/total` counts and funnels
that filter the grid. Behind the funnels sits the Channel filter, a tree that lives in the URL, so
a reload or a shared link keeps it and an old `?channelGroup=` link still works. The filter row
shows every Condition as a removable chip. This is the ticket every other CTB ticket builds on: it
lands the Channel filter's shape and the new bar together, and later tickets add number
Conditions, editing the logic, the selection tools and paste-to-follow on top. See
`.scratch/channels-top-bar/spec.md`, "The Channel filter", "The URL form", "The bar",
"Persistence and commands", and user stories 1 to 18, 33 to 38, 52 to 56, 79 to 87 and 102.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

### The Channel filter

- [ ] A pure module holds the Channel filter: the tree shape in the spec (a group of Conditions
      and groups joined by one operator, any node negatable, an empty group passing every
      Channel), its evaluation, and the editing operations the spec lists, including pruning empty
      and one-child groups after a remove or a move, keeping a negation when unwrapping, and
      refusing to move a group into itself
- [ ] This ticket's Conditions are tag (including the derived tags), Setting group and Language.
      The number Conditions arrive in CTB-02, but the shape already allows them
- [ ] The filter is written to the workspace URL in the readable text form and read back on load.
      The text form and parser are recovered from the prototype branch (commit `e4d5002`), not
      rewritten from scratch. It replaces the `channelGroup` parameter
- [ ] An old `?channelGroup=<id>` link becomes a one-Condition filter on that Setting group
- [ ] Setting groups are written by name and read back by name or id; a URL that does not parse is
      ignored and replaced on the next edit
- [ ] Changing the filter never changes the selection
- [ ] The channel search box narrows the Shown Channels on top of the filter, as today
- [ ] The palette's "filter by Setting group" command sets a one-Condition filter

### Row 1

- [ ] Follow (today's single-handle field, moved into a popover or a compact field at the start;
      CTB-05 replaces it with the paste box), the channel search, Groups, Tags, Languages, Sort
      with its direction button, the AI context pill, and Sync all
- [ ] Groups, Tags and Languages are one dropdown component: a search box, then a row per Setting
      group, tag or Language with a tick (selected, partial or none), `selected/total` counts and
      a funnel. Tags list the derived tags under their own heading with their explanation. The
      tag search is the Tags dropdown's search and still narrows which tags are listed
- [ ] Ticking a row selects or deselects every Channel in it. Languages are selectable, which
      today's bar cannot do
- [ ] Funnelling adds a Condition, unfunnelling removes every Condition with that value, and
      funnels in one dropdown join with OR while different dropdowns join with AND, exactly as the
      spec's funnel rule says. A dropdown with a "Clear funnels" link once one is on
- [ ] A dropdown's button shows its state: its name, the one funnelled value, or "3 tags", plus a
      count of rows with something selected, and looks filled in when a funnel is on
- [ ] Sort is a dropdown with a search over its options (Subscribers only when the setting shows
      them), with the direction button beside it
- [ ] The AI context pill holds the two existing prompt settings and shows how many are on

### The Channel filter row

- [ ] Shown only while something filters the grid: the "N of M" count, the search as a chip, one
      chip per Condition with an ×, the AND or OR between blocks (shown, not yet clickable; CTB-03
      makes it an editor), and "Clear all" once two or more filters are on
- [ ] Nested groups, if the URL carries any, render as boxes, so a shared link is shown faithfully
      before CTB-03 lands

### Row 2

- [ ] With nothing selected: the count, Select all and Invert (today's meanings)
- [ ] With a selection: the count with its clear button, All and Invert (today's meanings), Trim
      ("Keep first N"), Sync, Freeze, Unfreeze, Move to group in a popover, Tags (add and remove)
      in a popover, and Delete
- [ ] At the right end in both states: the "selected first, frozen last" and "sort rank" toggles
      and a four-way card size switch (tiles, compact, cards, detailed) writing the existing card
      zoom setting
- [ ] The section scrolls away with the page, as today, and its rows wrap at narrow widths with no
      control hidden. Checked at 375px

### Removed

- [ ] Today's toolbar, filter bar, bulk action row, Setting group chips and tag chips are gone,
      along with any helper only they used
- [ ] The Posts filter bar's conventions apply: sentence case labels, no uppercase micro labels

### Tests

- [ ] The Channel filter module: evaluation with AND, OR, NOT, nesting and empty groups; every
      editing operation including pruning and negated unwrapping; the funnel rule (second funnel
      of a type makes an OR group, a different type joins with AND, clearing removes every match); the URL
      form printing then parsing to the same tree, the spec's example string, a malformed string
      ignored, and the old `channelGroup` link. Prior art: the channel grid filter and sort tests
- [ ] Component tests for the dropdown (tick, partial tick, funnel, search, the button's state)
      and the filter row (×, Clear all at two or more). Prior art: the channel grid parts test
- [ ] The workspace search tests cover the new parameter and the old one
- [ ] The Channels end-to-end spec's selectors for trim, bulk tags, tag search and Setting group
      chips are moved to the new controls, and it gains a funnel-then-reload step that finds the
      filter still applied
- [ ] Every new test is watched failing before it is trusted
