# ZOOM-02: Shift-click range select at every zoom level

**What to build:** Shift-clicking a Channel selects or deselects every Channel between the last one
clicked and this one, at every zoom level. At 0 and +1 the gesture is on the checkbox; at -1 and -2
it is on the card toggle ZOOM-01 added. The run takes the state the clicked Channel is moving to,
and nothing outside it changes. See `.scratch/channel-card-zoom/spec.md`, user stories 30-39.

**Blocked by:** ZOOM-01 (both write the per-card selection callback).

**Status:** resolved

### Range selection rule

- [x] One pure function takes the current selection, the handles in on-screen order, the anchor (or none), the clicked handle, and whether shift is held. It returns the new selection and the new anchor
- [x] A plain click toggles the clicked Channel
- [x] A shift-click with the anchor on screen sets every Channel from the anchor to the clicked one, both ends included, to the clicked Channel's new state, in either direction
- [x] Selections outside the run are untouched
- [x] No anchor, or an anchor no longer on screen, makes a shift-click a plain toggle
- [x] The anchor becomes the clicked Channel on every click, plain or shift
- [x] Frozen and Unavailable Channels inside the run are treated like any other

### Wiring

- [x] The anchor lives in the channel grid beside the selection, not in `DataContext` (its field set is pinned)
- [x] The grid passes each card one selection callback carrying the clicked handle and whether shift was held. The checkbox (0 and +1) and the card toggle (-1 and -2) both call it, including from the keyboard
- [x] The on-screen order is the grid's filtered and sorted list, the same one it renders
- [x] All, None and Revert leave the anchor alone
- [x] Shift-click does not highlight text on the selection controls. Tag and Start ID text stays selectable

### Tests

- [x] Unit tests for the range function: plain toggle, run forward, run backward, deselecting a run, outside selections untouched, anchor off screen, no anchor, anchor equal to the clicked Channel, anchor moving on every click
- [x] Mutation-test them: break the function and watch the tests go red
- [x] Extend the ZOOM-01 Playwright journey: shift-click selects a run at 0 (on the checkbox) and at -2 (on the tile), and a second shift-click on a selected Channel deselects the run
- [x] Frontend lint, typecheck and unit tests pass

### Decided during implementation

The grid sorts selected Channels first and frozen ones last, so a plain click lifts its card to the
top and "between, in screen order" then runs from the top of the grid. The user chose a toggle
beside Sort By over changing the rule: grouped (today's view, the default) or one flat list in sort
order, where selecting or freezing moves nothing and a run stays where it was drawn. The choice is
remembered per account like the other sort controls. Trim still ranks within the grouped order.
