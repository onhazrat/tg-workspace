# TABS-02: Drag to reorder, and many tabs

**What to build:** Closable tabs can be dragged to a new position with the mouse, by press-and-hold
on touch, or from the keyboard. The Fixed tabs never move and nothing can be dropped before them.
Twenty open tabs still fit: tabs shrink down to their icon, then the strip scrolls sideways, and no
tab is ever closed automatically. On touch every Closable tab shows its ×. See
`.scratch/workspace-tabs/spec.md`, user stories 33-42, and the reordering and strip decisions.

**Blocked by:** TABS-01.

**Status:** resolved

- [x] The model gains move, which clamps to the Closable range so a Fixed tab can neither move nor be passed. The new order persists through the same storage as the open set
- [x] `@dnd-kit` (core plus sortable) is added as a frontend dependency, with pointer, touch and keyboard sensors (the pointer one is `MouseSensor`, so touch keeps its own hold delay)
- [x] Touch starts a drag only after about 250 ms press-and-hold, so a plain swipe scrolls the strip
- [x] Keyboard users pick up a focused tab with Space and move it with the arrow keys
- [x] The sortable attributes do not turn the tab links into buttons or give them a tab role. The links, `aria-current`, Cmd/Ctrl+click and "copy link address" keep working
- [x] Tabs shrink as more open, down to icon width, and then the strip scrolls horizontally. There is no cap on open tabs
- [x] On a shrunk tab, × replaces the icon when the tab is active or hovered
- [x] On touch devices × is visible on every Closable tab
- [x] Model unit tests cover move and its clamping
- [x] The TABS-01 Playwright spec gains a case that drags one Closable tab past another and checks the order survives a reload
- [x] Frontend lint, typecheck and unit tests pass
