# CTB-03: Build the logic

**What to build:** The Channel filter row becomes the place an Account builds the filter. Every
AND or OR is a switch for its pair of parentheses, any block can be negated with NOT, parentheses
are coloured boxes, and blocks drag: dropped on another chip they go into parentheses together,
dropped in a gap they move there. Every pair of parentheses has its own "+" to add a Condition
inside it. After this ticket, the spec's example
`(tag tech and reach > 200) or (tag news and (subscribers > 100 or reach > 1000) and
(activity rate < 10 or important))` can be built by hand and survives a reload. See
`.scratch/channels-top-bar/spec.md`, "The Channel filter", and user stories 39 to 51.

**Blocked by:** CTB-02

**Status:** ready-for-agent

### Editing

- [ ] The AND or OR between two blocks is a button; clicking it switches the operator of the whole
      group those blocks are in
- [ ] Every chip, every pair of parentheses and the whole filter has a NOT toggle: faint when off,
      red when on, and a negated block is outlined in red
- [ ] A chip has a button that puts it in parentheses by itself, with the opposite operator to its
      parent's
- [ ] Every pair of parentheses has a "+" that opens a condition picker: tag, Setting group,
      Language, or a number criterion, with a search. A number opens CTB-02's editor. The root has
      a "+" too
- [ ] Clicking a chip's label opens the same picker on that Condition to change it
- [ ] A pair of parentheses has a control to remove them and keep what was inside, offered only
      when the group is not negated
- [ ] Parentheses are drawn as boxes with a colour per depth, so matching pairs read at a glance

### Dragging

- [ ] Chips and whole pairs of parentheses drag. Dropping onto a chip puts the two in a new pair
      of parentheses where the target was, with the opposite operator to its parent's. Dropping
      into a gap moves the block there. A block cannot be dropped into itself
- [ ] Dragging a chip nested inside parentheses drags that chip, not the enclosing box. The
      prototype got this wrong first (the drag start bubbled to the outer box)
- [ ] Gaps show only while dragging and highlight under the pointer; the drop target highlights
- [ ] After a move or a remove, empty parentheses disappear and parentheses left holding one block
      unwrap, keeping any negation, as CTB-01's operations already do

### Funnels after hand edits

- [x] The dropdown funnels still reflect every Condition anywhere in the tree, and still only
      append or remove; they never reshape what the Account built, with one exception: a funnel
      joins a lone, un-negated, root-level Condition of its own type in an OR group, however that
      Condition was added. The tree does not record whether a funnel or the "+" added it, and the
      dropdown already shows it as funnelled, so two ticks in one dropdown mean OR (story 14)

### Tests

- [ ] The operations this ticket exposes are already covered by CTB-01's module tests; add any
      missing edge (NOT on the root, grouping two nodes from different depths)
- [ ] Component tests for the row: switching an operator, NOT on a chip and a group, the hidden
      ungroup on a negated group, drop on a chip groups, drop in a gap moves, a nested chip drags
      alone. Dispatch the drag events directly, as the prototype did; automated real-mouse
      drag-and-drop does not run in the browser pane
- [ ] The Channels end-to-end spec gains building a two-clause OR with a NOT and finding it after
      a reload
- [ ] Every new test is watched failing before it is trusted
