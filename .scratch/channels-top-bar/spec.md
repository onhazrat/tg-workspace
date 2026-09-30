# Channels top bar

Status: ready-for-agent

Ticket prefix: `CTB`.

Settled by a UI prototype run over one session (2026-09-30), about twenty variants narrowed to
one (S3), and a grilling session the same day. The prototype lives on the branch
`claude/channels-tabs-top-redesign-5b2b53`; its last commit before this spec is `8fe2be8`, and
`?variant=S3` on the Channels tab shows the winner. The terms **Setting group**, **Channel
filter**, **Condition**, **Shown Channels** and **Hidden selection** are in `CONTEXT.md`, and the
**Scope** entry now says it includes the Hidden selection.

## Problem Statement

The top of the Channels tab is five stacked rows of controls, and every row is always there. An
add-channel field, a channel search and a tag search sit side by side. Under them are a wall of
Setting group chips and a wall of tag chips, each chip meaning "select these" on a plain click and
"show only these" on a hidden cmd-click. Then a row of AI prompt checkboxes, language, sort, trim
and sort rank, and finally a bulk action row. It is tall whether or not anything is set, and
nothing on it says which filters are on.

It also cannot answer questions an Account keeps asking of its Channels:

- "Only the ones with a tag", or "only the Persian ones", as a filter rather than a selection.
  Tags cannot filter at all, and a Language filter is one value.
- "Channels with Reach over 1,000", "fewer than 100 subscribers", "quiet for a week". No number
  can filter.
- Anything with an OR or a NOT, or parentheses: "(tech with good Reach) or (news that is small
  or slow)".
- "Add what I can see to my selection" or "drop what the filters hide from it". Select all
  replaces the selection, and nothing touches only the part the filters hide.

And it lets an Account change Channels it cannot see. With 52 Channels selected and a filter
showing 12, Freeze, Move, Add tag and Delete reach all 52, with no sign that 40 of them are off
screen.

Following is one handle at a time, and every new Follow lands in the default Setting group, so
following ten Channels is ten adds and ten moves. The bulk tag fields accept any text, so a typo
creates a new tag instead of reaching an existing one.

## Solution

Two rows replace the five, and a third row appears only while something filters the grid.

**Row 1** reads left to right: **Follow**, the channel search, then dropdowns for **Groups**,
**Tags**, **Languages** and **Filters**, the **Sort** dropdown with its direction button, the
**AI context** pill, and **Sync all**. Groups, Tags and Languages are the same kind of dropdown.
Each has a search box, and each row in it has a tick that selects every Channel in that row, a
funnel that filters the grid to that row, and `selected/total` counts. Filters lists number
criteria such as Reach and subscribers. Picking one opens an editor with a histogram of the
Account's Channels on that number, which can be dragged across to choose a range.

**The Channel filter row** appears under row 1 whenever anything filters the grid. It shows the
count ("37 of 274"), then the whole Channel filter as blocks. A block is a Condition chip, and
parentheses are coloured boxes. Between blocks is an AND or OR the Account can click. Any block or
box can be negated with NOT. A chip dropped on another chip puts both in parentheses, and a chip
dropped into a gap moves there. Every box has its own "+" for adding a Condition inside it. The
funnels in the dropdowns add Conditions here, so the dropdowns and the row are one filter.

**Row 2** summarises when nothing is selected. When something is, it becomes the bulk toolbar:
the selection count, an **Adjust selection** button, Trim, Sync, Freeze, Unfreeze, Move to group,
Tags and Delete. At its right end are the layout toggles (selected first, sort rank) and a
four-way card size switch.

**Adjust selection** opens a Venn of "Selected" and "Shown". Its three regions are the Hidden
selection, the selected Channels that are shown, and the shown Channels that are not selected.
Clicking a region keeps or drops it, and five presets name the common edits. A line under it says
what will change before Apply does it. When the filters hide part of the selection, row 2 says so
("40 hidden by filters"). The row 2 actions, Trim and the sort rank then reach only the Shown
Channels, unless the Account chooses all of the selection.

**Follow** opens a box that takes any number of handles or t.me links. It marks each one "will
follow", "already following" or "not a handle", and follows the new ones into a chosen Setting
group. The bulk tag fields complete an existing tag name in ghost text.

The Channel filter lives in the URL, so a reload or a shared link keeps it. It is not part of the
Scope and never changes which Channels are selected.

## User Stories

### The bar

1. As an Account, I want the Channels tab's controls in two rows, so that the grid starts near the top of the page.
2. As an Account, I want the section to stay at the top of the tab and scroll away with it, as it does today, so that it does not cover the grid while I scroll.
3. As an Account, I want every control from today's bar to still exist, so that nothing I rely on is lost.
4. As an Account, I want labels in sentence case, so that the bar matches the Posts tab and reads as text.
5. As an Account, I want a dropdown's button to show its current state (the funnelled value, or "3 tags", and a count of rows with something selected), so that I can read the bar without opening anything.
6. As an Account, I want a dropdown with something set to look filled in, so that I can see at a glance which filters are on.
7. As an Account on a narrow screen, I want the rows to wrap rather than hide controls, so that every control stays where I learned it.

### Groups, Tags and Languages

8. As an Account, I want Groups, Tags and Languages to be the same kind of dropdown, so that I learn one control and use it three times.
9. As an Account, I want a search box in each of them, so that I can find a Setting group, tag or Language in a long list.
10. As an Account, I want to tick a row to select every Channel in it, so that I can build a selection by tag, Setting group or Language.
11. As an Account, I want a partly selected row to show a partial tick, so that I know some of its Channels are selected.
12. As an Account, I want `selected/total` on every row, so that I know how much of it I have selected.
13. As an Account, I want a funnel on every row that filters the grid to that row, so that "show only these" is a visible control and not a hidden cmd-click.
14. As an Account, I want to funnel several rows in one dropdown, so that "tech or news" is two clicks.
15. As an Account, I want Languages to be selectable like Setting groups, so that "select every Persian Channel" is possible.
16. As an Account, I want tags to be filterable, so that "show only tech" is possible.
17. As an Account, I want the derived tags (Untagged, Partial history) in the Tags dropdown with an explanation, so that I can select and filter on them like any tag.
18. As an Account, I want a "Clear funnels" link inside a dropdown once one is on, so that I can undo its filters in one click.

### Filters (numbers)

19. As an Account, I want to filter Channels on subscribers, Reach, activity rate, total Posts, Posts in the Scope, days since the last update, days followed, and photo, video, file and link counts, so that I can find Channels by size and activity.
20. As an Account, I want the Filters dropdown to list every criterion with its current bound, so that I can see what is set.
21. As an Account, I want a search box in the Filters dropdown, so that I can find a criterion quickly.
22. As an Account, I want each criterion to offer at least, at most, between and no value, so that I can say exactly what I mean.
23. As an Account, I want to see a histogram of my Channels on a criterion before I set a bound, so that I choose a number that means something for my Channels.
24. As an Account, I want to drag across the histogram to set a range, so that I can choose one without typing.
25. As an Account, I want a drag that touches the first bar to become "at most" and one that touches the last bar to become "at least", so that an open-ended range is one gesture.
26. As an Account, I want the dragged edges rounded to two significant figures, so that the bound reads as 1,200 rather than 1,187.43.
27. As an Account, I want hovering a bar to say how many Channels it holds and its range, so that I can read the distribution.
28. As an Account, I want wide ranges such as subscribers on a logarithmic axis, so that most Channels do not land in the first bar.
29. As an Account, I want the editor to say how many of my Channels the bound keeps before I add it, so that I do not add a filter that leaves nothing.
30. As an Account, I want the same criterion usable more than once, so that "Reach over 200 in one clause and over 1,000 in another" is possible.
31. As an Account, I want to be told that a Channel with no value for a number does not match a bound on it, so that the count does not surprise me.
32. As an Account, I want a "no value" Condition, so that I can find the Channels we have not measured yet.

### The Channel filter

33. As an Account, I want a row that shows the whole Channel filter whenever something filters the grid, so that I always know why a Channel is missing.
34. As an Account, I want that row to show how many Channels are shown out of how many I follow, so that I know what the filter left.
35. As an Account, I want each Condition as a chip I can click to change, so that I can edit a filter without rebuilding it.
36. As an Account, I want an × on every chip, so that I can remove one Condition.
37. As an Account, I want "Clear all" once two or more filters are on, so that I can start over in one click.
38. As an Account, I want the joiner between blocks shown as AND or OR, so that I can read the filter as a sentence.
39. As an Account, I want to click a joiner to switch it between AND and OR for that whole pair of parentheses, so that changing the logic is one click.
40. As an Account, I want parentheses drawn as coloured boxes, a colour per depth, so that I can see which parts belong together.
41. As an Account, I want to drop one chip onto another to put both in parentheses, so that grouping is a gesture.
42. As an Account, I want to drop a chip into a gap to move it, so that I can reorder the filter.
43. As an Account, I want to drag a whole pair of parentheses as one block, so that I can move a clause.
44. As an Account, I want a "+" inside every pair of parentheses, so that a new Condition can start life nested.
45. As an Account, I want a button on a chip that puts it in parentheses by itself, so that I can start a clause from one Condition.
46. As an Account, I want to remove a pair of parentheses and keep what was inside, so that I can flatten a clause.
47. As an Account, I want parentheses left holding one Condition to disappear on their own, so that the filter never shows "( a )".
48. As an Account, I want NOT on any Condition, any pair of parentheses and the whole filter, so that "not spam" and "not (tech or news)" are possible.
49. As an Account, I want a negated block outlined in red, so that I cannot miss a NOT.
50. As an Account, I want removing the parentheses of a negated block to be unavailable, so that I cannot silently change what it means.
51. As an Account, I want AND to bind tighter than OR, so that the filter means what it would in any query language.
52. As an Account, I want the dropdown funnels to add Conditions to the same filter, and unfunnelling to remove them, so that the dropdowns and the row never disagree.
53. As an Account, I want the channel search to narrow the grid on top of the Channel filter, so that I can search inside what I filtered.
54. As an Account, I want the Channel filter kept in the address bar, so that a reload keeps it and I can share or bookmark a filtered view.
55. As an Account, I want an old link that filtered to one Setting group to still work, so that my bookmarks keep working.
56. As an Account, I want changing the Channel filter never to change my selection, so that filtering is safe to try.

### Selection

57. As an Account, I want an Adjust selection button in the bulk toolbar, so that every way to change the selection relative to the filters is in one place.
58. As an Account, I want to see my selection and the Shown Channels as two overlapping circles, with the count in each region, so that I understand what the filters hide.
59. As an Account, I want to click a region to keep it selected or drop it, so that any combination is one or two clicks.
60. As an Account, I want a dropped region hatched and its count faded, so that "dropped" reads differently from "empty".
61. As an Account, I want the regions reachable and switchable from the keyboard, so that I can adjust the selection without a mouse.
62. As an Account, I want "Remove shown", so that I can keep my selection but drop the Channels I am looking at.
63. As an Account, I want "Keep only shown", so that I can drop what the filters hide.
64. As an Account, I want "Add shown", so that I can add everything I am looking at without losing the rest.
65. As an Account, I want "Invert shown", so that I can flip what I am looking at and leave the rest alone.
66. As an Account, I want "Select only shown", so that I can make the selection exactly what I see.
67. As an Account, I want the preset that matches my clicks to light up, so that I learn what my picture is called.
68. As an Account, I want a line that says "52 → 30 selected, −40 dropped, +18 added" before I apply, so that I know what will happen.
69. As an Account, I want Apply disabled when nothing would change, so that I do not wonder whether it worked.
70. As an Account, I want row 2 to say how much of my selection the filters hide, so that I know the toolbar is not showing me everything.
71. As an Account, I want Sync, Freeze, Unfreeze, Move to group, Add tag, Remove tag and Delete to reach only the Shown Channels by default, so that I do not change Channels I cannot see.
72. As an Account, I want to choose "all of the selection" for those actions when I mean it, so that the limit never stops me.
73. As an Account, I want my choice remembered, so that I do not set it on every visit.
74. As an Account, I want a confirm dialog to name both numbers when part of the selection is hidden ("Delete 12 Channels. 40 selected Channels hidden by filters are not affected."), so that the limit is visible when it matters.
75. As an Account, I want Trim to rank only the Shown Channels under the same limit, keeping the Hidden selection selected, so that Trim agrees with the other actions.
76. As an Account, I want the sort rank on each card to count the same Channels Trim ranks, so that "#3" still means "survives Keep first 3".
77. As an Account, I want the Hidden selection to stay in the Scope, so that a Summary or Chat covers every Channel I selected, not just the ones this tab shows.
78. As an Account, I want shift-click range selection to keep working, so that I keep today's fastest way to select a run of cards.

### Row 2 and view settings

79. As an Account, I want the card size as a visible four-way switch (tiles, compact, cards, detailed), so that I can jump to any size in one click.
80. As an Account, I want "selected first, frozen last" and "sort rank" as toggles next to the card size, so that the settings that change the grid sit together.
81. As an Account, I want the card size and layout toggles in the same place whether or not anything is selected, so that nothing moves when I select.
82. As an Account, I want Trim ("Keep first N") in the bulk toolbar, so that I can shrink a selection by the current sort.
83. As an Account, I want Move to group and the tag fields in small popovers from the toolbar, so that the toolbar stays one line.

### AI context and sort

84. As an Account, I want the AI prompt context settings (channel bio, current tags) in their own pill, so that they are not hidden among view settings.
85. As an Account, I want the AI context pill to show how many of them are on, so that I know my prompts include them.
86. As an Account, I want the Sort dropdown to have a search box, so that I can find one of its twelve options quickly.
87. As an Account, I want the sort direction as a button next to it, so that flipping the order is one click.

### Follow

88. As an Account, I want Follow at the start of row 1, so that the most common way to grow my list is the first control.
89. As an Account, I want to paste many handles or links at once, separated by lines, spaces or commas, so that following ten Channels is one paste.
90. As an Account, I want `@handle`, `t.me/handle` and `t.me/s/handle` all understood, so that I can paste whatever I copied.
91. As an Account, I want each pasted handle marked "will follow", "already following" or "not a handle" before I follow, so that I fix mistakes first.
92. As an Account, I want duplicates in the paste collapsed, so that I do not follow a Channel twice.
93. As an Account, I want to choose the Setting group new Follows land in, so that I do not have to move them afterwards.
94. As an Account, I want the follow button to say how many it will follow, so that I know what one click does.
95. As an Account, I want to see progress while a paste of many Channels is followed, so that I know it is working.

### Tags in the bulk toolbar

96. As an Account, I want the add-tag field to complete an existing tag name in grey as I type, so that I reuse tags instead of creating near-duplicates.
97. As an Account, I want Tab (or → at the end) to accept the completion and Enter to submit what I typed, so that completing never gets in the way of a new tag.
98. As an Account, I want add suggestions ordered by how many Channels use the tag, and to skip tags every selected Channel already has, so that the likely tag comes first.
99. As an Account, I want remove suggestions to come only from tags on the selected Channels, so that I cannot "remove" a tag nothing has.
100. As an Account, I want a hint saying how many Channels carry the suggested tag, and "no existing tag starts like this" when none does, so that I catch a typo before creating a tag.

### Command palette

101. As an Account, I want the five selection edits and the action limit in the command palette, so that I can use them from the keyboard.
102. As an Account, I want the palette's "filter by Setting group" command to set the Channel filter, so that it keeps working.

## Implementation Decisions

### The Channel filter

- A Channel filter is a tree. A group holds Conditions and other groups joined by one operator,
  and any node can be negated. The root is always a group, and an empty group passes every
  Channel, negated or not, so an empty or "not ()" filter hides nothing. Shape from the prototype:

  ```
  Cond      = { type: "tag" | "group" | "language"; value: string }
            | { type: "metric"; metric: MetricKey; min?: number; max?: number; none?: true }
  AtomNode  = { kind: "atom";  id; cond: Cond; not?: boolean }
  GroupNode = { kind: "group"; id; op: "and" | "or"; not?: boolean; children: Node[] }
  ```

  `none` is the "no value" Condition. It passes a Channel with no value for the metric, and NOT
  on it means "has a value". A `tag` Condition's value may be one of the derived tag ids.
- Evaluation is plain and three-valued only where stated: a bound on a metric fails a Channel
  with no value, and NOT of that is true. This is what the editor explains.
- The editing operations are pure functions over the tree: append into a group, remove, replace,
  set a group's operator, toggle NOT, move to a group and index, put in parentheses, group two
  nodes (drop one on another), and remove parentheses. After a remove or a move, groups left
  empty are dropped and groups left with one child are unwrapped. Unwrapping keeps the negation:
  "not (a)" becomes "not a", and "not (not a)" becomes "a". Moving a group into itself is
  refused.
- Grouping two nodes makes the new group's operator the opposite of its parent's, since that is
  why one groups.
- The editor never offers to remove the parentheses of a negated group.
- The dropdown funnels are a view of the tree: a funnelled value is one that appears in a
  Condition of that type anywhere in the tree. Clearing a funnel removes every Condition with that
  value.
- Funnels in one dropdown join each other with OR, so two tag funnels mean "tech or news", as
  story 14 says. The first funnel of a type appends its Condition to the root; the second wraps
  the root-level Condition of that type and itself in an OR group; later ones join that group.
  Different dropdowns' funnels join with AND at the root. Once the Account edits the tree by hand,
  the funnels still only append to or remove from it, and never reshape it. The prototype
  appended every funnel to the root and so joined two tags with AND; that was a prototype shortcut, not a
  decision.
- The Filters dropdown always adds a new metric Condition to the root, so the same criterion can
  appear several times. Clicking a metric chip reopens its editor on that Condition.
- The channel search box is not part of the tree. It narrows the Shown Channels on top of it,
  exactly as today.
- Filtering stays in the browser over the Account's followed Channels, as it does today. Metric
  values come from the channel list and the channel stats the tab already loads, and Posts in
  the Scope from the counts it already requests.

### The URL form

- The Channel filter is serialized to a readable text form in the workspace URL, replacing the
  `channelGroup` parameter, and parsed back when the page loads. The text form and its parser were
  written and tested in the prototype (commit `e4d5002`, `tree.ts`) and are reused:
  `tag:name`, `group:"Setting group name"`, `lang:fa`, `reach >= 200`, `subscribers <= 100`,
  `reach 200..1000`, `not`, `and`, `or`, parentheses. NOT binds tightest, then AND, then OR.
  Printing then parsing must give back the same tree.
- The text form is a storage format. The UI never asks anyone to type it.
- An old `?channelGroup=<id>` becomes a one-Condition filter on that Setting group.
- A URL whose filter does not parse is ignored rather than shown as an error, and replaced on
  the next edit.
- Setting groups are written by name, and read back by name or by id, so a renamed group in an
  old link still resolves by id.

### Selection

- Every selection edit relative to the filters keeps or drops three regions, S − F (the Hidden
  selection), S ∩ F and F − S, where S is the selection and F the Shown Channels. The five named
  edits are rows of one table (from the prototype):

  | Edit              | Keeps S − F | Keeps S ∩ F | Adds F − S |
  | ----------------- | ----------- | ----------- | ---------- |
  | Add shown         | yes         | yes         | yes        |
  | Remove shown      | yes         | no          | no         |
  | Keep only shown   | no          | yes         | no         |
  | Invert shown      | yes         | no          | yes        |
  | Select only shown | no          | yes         | yes        |

  Today's "All" is "Select only shown" and today's "Revert" is "Invert shown". Both keep working
  in the palette under those meanings.
- The selection stays in the data context, whose field set is pinned. The new pure module takes
  the selection and the Shown Channels and returns the next selection.
- The action limit ("Actions apply to: Shown / All") is an Account preference in the settings
  schema, default Shown. It decides the set every row 2 action receives, the set Trim ranks and
  the set the card sort rank counts. It does not reach the Scope, the Posts tab or any Artifact.
- With the limit on Shown, Trim ranks S ∩ F and writes back S − F plus the Channels it kept. The
  sort rank numbers are computed over the same set, so a card's "#N" is its place in what Trim
  would keep.
- The existing freeze, unfreeze and delete confirmations take both counts and name the Hidden
  selection when it is non-empty.
- The row 2 indicator shows only when the Hidden selection is non-empty: amber "N hidden by
  filters" with the limit on All, blue "acting on N shown" with it on Shown. Clicking it switches
  the limit.

### Follow

- The paste box parses with the existing handle normalizer and checks each handle against the
  followed Channels. A handle is 4 to 32 letters, digits or underscores; that is a shape check,
  and the follow still asks Telegram.
- Every follow from the paste box, one handle or many, goes through the existing bulk-follow job
  route and its progress events, which Discover already uses.
- The bulk-follow request gains an optional `settingGroupId`. When it is present, every Follow the
  job creates lands in that Setting group. It is checked against the caller's own Setting groups
  before the job starts: another Account's Setting group answers the same 404 an absent one does,
  and no Follow is created. When absent, behaviour is unchanged (the default Setting group), so
  Discover is unaffected.
- `PUT /data/channels/{id}` keeps refusing a setting group, as it does deliberately today. The
  inline single-follow path is replaced by the paste box, so nothing needs it.
- A handle already followed is skipped, not re-followed, and the paste box says so before sending.

### Tags

- Add suggestions are every tag on the Account's Channels, most used first, without the tags
  every selected Channel already has. Remove suggestions are the tags on the selected Channels,
  most common among them first. Both honour the action limit: "selected" means the set the
  actions reach.
- The completion is the best suggestion that starts with what was typed, case-insensitive, drawn
  after the caret. Tab, or → with the caret at the end, accepts it. Enter submits what was typed.

### The bar

- Row 1: Follow, search, Groups, Tags, Languages, Filters, Sort with direction, AI context, Sync
  all. Row 2: the summary or the bulk toolbar, then the layout toggles and the card size switch at
  the right in both states. The Channel filter row sits between them and shows only while
  something filters the grid.
- Groups, Tags and Languages are one dropdown component. It takes a list of rows (label, hint,
  the Channel names in the row), the selection, the funnelled values, and a search mode: its own,
  or the existing tag search, which also narrows which tags are listed.
- The visual conventions are the Posts filter bar's: sentence case, a dropdown that fills in when
  set, the "N of M" count, and "Clear all" at two or more filters.
- Radix's popover is the popover everywhere. A trigger that is a component must forward the
  props and ref the popover gives it, or it never opens; the prototype hit this twice.
- The AI context pill holds the two existing prompt settings unchanged. The card size switch
  writes the existing card zoom setting. The layout toggles write the existing settings.
- The rows wrap at narrow widths. There is no collapsed or phone-only layout.
- Today's toolbar, filter bar, bulk actions, group chips and tag chips are removed. The tag chip
  collapse helper goes with them if nothing else uses it.

### Persistence and commands

- The Channel filter is in the URL. The action limit and every existing view setting are settings
  schema entries, per Account. The dropdown searches and the paste box text are page state.
- The palette gains the five selection edits and "Actions apply to: Shown / All". Its existing
  "filter by Setting group" command sets a one-Condition Channel filter.

## Testing Decisions

- A good test drives the behaviour an Account relies on and asserts what comes out: which
  Channels are shown, what the selection becomes, what a request carried. Not how a component is
  built. Each guard is mutation-tested before it is trusted: make the rule wrong and watch the
  test fail.
- **Pure modules** (`bun test`, prior art: the channel grid, trim, sort rank and range selection
  tests):
  - The Channel filter: evaluation with AND, OR, NOT, nesting, empty groups, "no value" and a
    missing value under NOT; every editing operation, including pruning, unwrapping a negated
    single child, refusing to move a group into itself, and the funnel sync; and the URL form,
    including the user's own example
    `(tag tech and reach > 200) or (tag news and (subscribers > 100 or reach > 1000) and
    (activity rate < 10 or important))`, print then parse giving the same tree, and a malformed
    string being ignored.
  - Selection regions: the five edits on a selection with all three regions non-empty, the no-op
    detection, and the set the action limit yields.
  - Trim and the sort rank under the limit: the Hidden selection survives Trim, and the card with
    rank 1 is the one Keep first 1 keeps.
  - Handle parsing (the three link forms, duplicates, the shape check) and tag suggestions (order,
    skipping tags every selected Channel has, remove drawn only from the selection).
- **Component tests** (testing-library in `bun test`, prior art: the channel grid parts test),
  one per new branching component, asserting behaviour: the dropdown ticks and funnels; the
  histogram drag gives the right operator at either edge; the Channel filter row's drop-on-chip
  groups and drop-in-gap moves (drag events dispatched directly, as the prototype did); NOT and
  the hidden ungroup; the Venn's regions and presets and the before and after line; the paste box
  statuses; the ghost completion accepting on Tab. The frontend CRAP ratchet in CI fails a new
  branching component without one.
- **One end-to-end journey** in the existing Channels spec with a mocked API: follow two Channels
  from a paste into a Setting group; funnel a tag and add a Reach bound; select everything, narrow
  the filter, and see the Hidden selection indicator; run Add tag and see the request carry only
  the Shown Channels; switch the limit to All and see it carry all of them; reload and find the
  filter still there. The existing selectors for trim, bulk tags, tag search and group chips are
  updated in the same change rather than dropped. Runs serially, per the Channels spec's existing
  setup.
- **Backend route tests** (pytest, prior art: the bulk-follow tests and
  `tests/api/test_account_isolation.py`): bulk follow with a `settingGroupId` lands every new
  Follow in it; another Account's Setting group answers 404 and creates no Follow; no
  `settingGroupId` keeps today's behaviour. The isolation guard's probe for the route is updated
  for the new field.
- The URL parameter's validation joins the existing workspace search tests, including the old
  `channelGroup` link.

## Out of Scope

- A text box for typing a Channel filter. The text form is stored in the URL but never typed.
- An outline editor for the Channel filter (the prototype's T2) and any other editor than blocks.
- Saved or named Channel filters.
- A Channel filter in the Scope, or on any tab other than Channels.
- Server-side filtering of the channel list. It stays in the browser.
- Following into a Setting group through `PUT /data/channels/{id}`.
- A phone-only layout for the bar.
- Undo for a selection edit or a bulk action.

## Further Notes

- The prototype is throwaway. Rewrite its components properly rather than promoting them: it has
  no tests, stubs every write with a toast, keeps state in `ChannelGrid` for convenience, and
  carries every losing variant behind `?variant=`. Its pure modules (`tree.ts`, `selection.ts`,
  `metrics.ts`, the handle parser) are the closest to reusable, and the URL text form should be
  recovered from commit `e4d5002`, where it was deleted after T3 lost.
- The prototype's decision trail, one commit per round, is on the branch: bar layout (A to A5),
  follow (F1 to F4), number filters (N1 to N3), AND/OR (L1 to L3), nesting (T1 to T3), NOT, and
  selection (S1 to S3).
- The Posts filter bar (`.scratch/post-filter-bar/`) is the sibling redesign whose conventions
  this one borrows. The Channel filter is deliberately a different thing from its post filters:
  it chooses which Channels are shown on this tab, and never what an Artifact covers.
