# TML-01: The Timeline for everything the workspace shows

**What to build:** Every change to what the workspace shows becomes a Step on
a Timeline, and Undo and Redo move along it. Cmd+Z and Cmd+Shift+Z work
outside text fields, `u` and `U` in Keyboard mode, and undo and redo buttons
sit in the app header's button row beside Routing with a Timeline button that
opens the drawer (`h`). Clearing a Channel selection, closing a tab, switching
tabs, narrowing the Directory, changing the Card size or the Analysis window:
each is one undo. The drawer lists the Timeline newest first with what each
Step changed, jumps to any Step, branches instead of dropping undone Steps,
fades Steps off the current path, and narrows to the open tab (`t`). No server
write is recorded yet; that is TML-02.

Spec: `.scratch/filter-memory/spec.md` (The Timeline in the browser; user
stories 1 to 16, 38 to 49, 59). Glossary: Timeline, Step. Reference:
`prototype/filter-memory`, variant F, whose store and drawer this replaces
with a React-free model.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A React-free Timeline model records Steps, branches on a change after an undo, and answers undo, redo and go-to with what to do (writes to send in order, the view state to restore) without sending or rendering anything. It passes over Steps marked not undoable, keeps at most 200 Steps or 7 days, and writes each Step's change text by comparing it with the Step it was made from.
- [ ] View state providers read and restore: the workspace URL (every tab's filters and the open Artifact), the open tabs and their order, the Channel selection, the Analysis window (Live as Live, Fixed as Fixed), the Post selection, the Directory selection, and the view preference Settings such as Card size.
- [ ] A one-line hook lets a component's own view state join; the Requests selection and the Requests side panel join through it.
- [ ] Scroll position, hover, open menus, the Highlight and text still being typed never make a Step; a filter makes one when committed.
- [ ] Each switch between tabs, and each tab opened, closed or moved, is a Step; undoing a close puts the tab back in its place.
- [ ] The Timeline is kept per browser tab in session storage scoped to the Account, outlives a reload, and is cleared at sign-out. View-as keeps a separate Timeline that ends with it.
- [ ] The header holds undo, redo (each disabled when there is nothing to do) and the Timeline button with the Step count; they fit at phone width.
- [ ] The drawer shows each Step's change text, number, age and "branched from #n", jumps with Enter or a click, moves with `j` and `k`, narrows with `t`, closes with `h` or Esc.
- [ ] The keys pass the key list's one-key-one-meaning check, and the corner and full key guides list them in Keyboard mode's wording.
- [ ] `bun test` covers the model: recording, the branch walk, passing over, the cap and the change text. One Playwright spec against mocked routes covers Cmd+Z, the header buttons and the drawer for a filter change, a selection clear and a tab close.
- [ ] Variant 0 behaviour on main is unchanged except for the new controls; existing unit and Playwright suites pass.
