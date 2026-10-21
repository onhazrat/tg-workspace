# Spec: The Directory photo viewer and one Keyboard mode

Status: ready-for-agent

Decisions: `docs/migration/ADR-034-one-keyboard-mode.md` and
`docs/keyboard-mode-plan.md` (19 settled decisions). Prototype: variant H
(`?variant=H`) on
[`prototype/directory-photo-viewer` @ a6aa1eb6](https://github.com/onhazrat/tg-workspace/tree/a6aa1eb6ecbef4886a48817d6228344d6ed64778),
notes and a file map in `prototype.md` beside this file. Vocabulary (Keyboard
mode, Highlight, Tick, Pick, Channels tab selection, Channel spotlight,
Dismissal, Candidate, Discovery report, Artifact, Fixed tab, Closable tab,
Focus mode) is `CONTEXT.md`'s. Ticket ids carry the prefix `KM`.

## Tickets

Three tickets in `issues/` beside this file, as few as the work allows, run in
order.

| Id | Ticket | Blocked by |
|---|---|---|
| KM-01 | The Directory photo viewer (`issues/01-directory-photo-viewer.md`) | None |
| KM-02 | One Keyboard mode for Posts, Channels and the Directory (`issues/02-one-keyboard-mode.md`) | KM-01 |
| KM-03 | Discover, History, and acting on many (`issues/03-discover-history-acting-on-many.md`) | KM-02 |

Each ticket names the prototype files to read, pinned to a6aa1eb6, through
`prototype.md`. A ticket closes as `docs/agents/issue-tracker.md` says.

## Problem Statement

The Directory shows every Channel's photo as a small avatar, but unlike the
Channels tab, clicking it does nothing: there is no way to look at a photo
bigger than 28 pixels without leaving for Telegram.

Keyboard mode exists on three tabs and is three different things. Posts,
Channels and the Directory each have their own switch, their own legend and
their own letters, and the letters disagree: `f` shows one Channel alone in
Posts, freezes a Channel on the Channels tab and follows one in the Directory.
Turning keyboard mode on in one tab leaves it off in the next. Discover and
History, both lists worked through one item at a time, have no keyboard mode
at all. There is no way to change tabs, search, or act on many items from the
keyboard, so a keyboard session keeps falling back to the mouse. The legend
sits in a corner whether or not it is wanted, and the shortcuts dialog shouts
in capitals that read as Shift.

The keys also read the typed character, so with a Persian keyboard layout
active nothing fires.

## Solution

The Directory's avatars open the same photo viewer the Channels tab uses, from
a row or from the panel, with the viewer's arrows stepping through the rows of
the page.

Keyboard mode becomes one thing for the whole workspace: one switch in the
header beside the command palette (and `\`), one list of keys in which every
letter means the same action wherever it appears, and vim's way of moving:
`j` / `k`, `gg` / `G`, counts on moves (`5j`, `37G`), `g` then a letter to go
to a tab, and `gt` / `gT` through the tab strip (`3gt` is the third tab). Posts,
Channels, the Directory, a Discovery report and History all work the same way.
`?` steps from nothing, to the tab's keys in the bottom-left corner, to the
full list; a waiting `g` or count shows what it leads to just above the
corner. Capitals are the key with Shift: `J` / `K` tick while moving, `F` / `D`
act on everything ticked, `M` opens every Post. Keys are read by position, so a
Persian layout works. Each move is said to a screen reader.

## User Stories

### The Directory photo viewer

1. As a Directory user, I want to click a row's avatar to see the Channel's photo full screen, so that I can judge a Channel by its picture without leaving the app.
2. As a Directory user, I want clicking the rest of the row to still open the panel, so that the avatar's new job does not take the row's old one.
3. As a Directory user, I want the panel's photo to open the viewer too, so that the biggest photo on screen is the one I can enlarge.
4. As a Directory user, I want the viewer's arrows to step through the photos of the rows on the page, so that I can browse photos the way I browse rows.
5. As a Directory user, I want the panel's photo to open on its own, without arrows, so that it never appears twice in the sequence beside its own row.
6. As a Directory user, I want the viewer to open on the photo I clicked, even when a row and the panel show the same photo, so that it never opens on the wrong copy.
7. As a Directory user, I want closing the viewer to leave the page at the row of the last photo I viewed, so that browsing photos moves me through the list.
8. As a phone user, I want the avatars in the Directory's card list to open the viewer too, so that the feature is not desk-only.
9. As a phone user, I want every avatar to keep its size, so that a long Channel name never squeezes a photo down to a sliver.
10. As a keyboard user, I want `p` to open the Highlight's photo and `p` again to close the viewer, so that one key toggles it in every tab with photos.
11. As a keyboard user, I want `h` and `l` to step photos inside the viewer, as the arrows do, so that my hand stays on the home row.

### One Keyboard mode

12. As a keyboard user, I want one switch that turns keyboard mode on for every tab, so that I do not turn it on again each time I change tabs.
13. As a keyboard user, I want that switch in the header, left of the command palette, filled while on, so that I can see at a glance whether it is on.
14. As a keyboard user, I want `\` to turn keyboard mode on and off from any tab, including with the shortcuts list open, so that I never need the mouse to start or stop.
15. As a keyboard user, I want keyboard mode to last the browser session, so that it does not follow me into tomorrow uninvited.
16. As a keyboard user, I want a letter to mean the same action in every tab that has that action, so that I learn each key once.
17. As a keyboard user, I want `x` to Tick, select or Pick, using the word of the tab I am in, so that the keys speak the same language as the rest of the app.
18. As a keyboard user, I want each control's key in its tooltip while keyboard mode is on, so that I can learn the keys from the controls themselves.
19. As a Persian speaker, I want the keys to work with a Persian layout active, so that I do not switch layouts to use keyboard mode.
20. As a keyboard user, I want each tab to keep its Highlight when I switch away and back, so that I return to where I was.
21. As a keyboard user, I want `-` and `+` to make cards smaller and larger in Channels and compact or full in Posts, so that I can change density without the mouse.
22. As a keyboard user, I want `m` to open or close a long Post's text or a Channel's bio, and `M` to do it for every Post, so that reading long Posts needs no clicks.
23. As a Posts reader, I want `c` to show the Highlight's Channel alone and `c` again to go back to the feed, so that a Channel spotlight is one key in and one key out.
24. As a Channels tab user, I want `c` to open the Highlight's Channel in Posts and `c` there to bring me back to it, so that I can read a Channel's Posts and return.
25. As a keyboard user, I want `/` to put the cursor in the tab's search box and Esc to give the keys back, so that searching does not end keyboard mode.
26. As a keyboard user, I want Esc to drop the Highlight in every tab, Posts included, so that Esc means one thing everywhere.

### Help that comes when asked

27. As a keyboard user, I want `?` to step from nothing, to the tab's keys in the corner, to the full list, and back, so that I choose how much help is on screen.
28. As a keyboard user, I want the header's shortcuts button to step through the same three, so that the mouse and the key agree.
29. As a keyboard user, I want only a small pill saying "keyboard mode · ? keys · \ off" when no list is shown, so that the corner stays quiet.
30. As a keyboard user, I want turning keyboard mode off to hide every hint and turning it on to bring back what was showing, so that switching is not a reset.
31. As a keyboard user, I want the full list in sentence case with keys as typed, a capital meaning Shift, so that `x` never reads as Shift+x.
32. As a keyboard user, I want the full list to open below the header and scroll within the window, so that it never covers the buttons that close it.
33. As a phone user, I want neither the keyboard mode switch nor the shortcuts button on my phone, so that no control appears that I cannot use.
34. As a keyboard user, I want the header's buttons grouped (keyboard, then help, then view), so that related controls sit together.

### Getting around

35. As a keyboard user, I want `g` then a letter to go to a tab from any tab, so that every tab is two keys away.
36. As a keyboard user, I want the keys a waiting `g` leads to listed just above the corner, after a moment, so that I need not memorise them and a quick `gt` never flashes the list.
37. As a keyboard user, I want `gt` and `gT` to go to the next and previous tab in the strip, wrapping around, so that I can reach any one of several Summary tabs.
38. As a vim user, I want `3gt` to go to the third tab and `5gT` five tabs back, with the count before or after the `g`, so that counts mean what vim taught me.
39. As a keyboard user, I want `gx` to close the tab I am on and `gX` to reopen the one closed last, so that a mistaken close is one key to undo.
40. As a keyboard user, I want `gx` to do nothing on a Fixed tab, so that Channels, Posts and Action cannot be closed by accident.
41. As a keyboard user, I want `5j`, `7k` and `37G` to move by a count, so that long lists are quick to cross.
42. As a keyboard user, I want a count before any key that is not a move to be dropped, so that `4x` never ticks four entries.
43. As a keyboard user, I want Esc, `?` or a click to cancel a waiting `g` or count, so that nothing fires later from a key I have forgotten.
44. As a keyboard user, I want `gg` to go to the first item and `5gg` to the fifth, in every list, so that the moves are the same everywhere.

### Discover and History

45. As a Discover user, I want keyboard mode on a Discovery report's Candidates, with `x`, `f`, `d`, `o` and Enter for Details, so that I can triage a report without the mouse.
46. As a History user, I want keyboard mode on the list of Artifacts, with Enter to open, `*` to star and `n` to edit the note, so that I can work through what I made.
47. As a History user, I want no key that deletes, so that one wrong key never loses an Artifact.

### Acting on many

48. As a Directory or Discover user, I want `J` and `K` to tick while moving, or untick when my last `x` unticked, so that I can mark a run of entries in one sweep.
49. As a Directory or Discover user, I want `F` to follow and `D` to dismiss everything ticked, through the bulk bar's own buttons, so that a sweep ends in one key and keeps the bar's confirmation.
50. As a keyboard user, I want `d` and `*` to say what they did, on what, with an Undo, so that a key acting on an item I cannot see is never silent.
51. As a keyboard user, I want a ticked Directory entry, a ticked Candidate and a selected Channel to look the same, so that marked items read alike in every tab.
52. As a screen reader user, I want each move announced with the item's name and its place ("@name, 6 of 20"), so that I can follow the Highlight without seeing it.

## Implementation Decisions

- **One key list.** One module names every action, its key and its label in
  each tab's word, and each tab declares which actions it has. The table in
  ADR-034 is the list. A clash between two actions is impossible by
  construction, and the shortcuts dialog, the corner list, the tooltips and
  the toasts all read their keys from it. The controls carry the list's key;
  the prototype's translation from a control's old letter to the list's
  (`controlKey`) is a prototype shortcut and is not ported.
- **One keyboard engine, in two parts.** A pure key interpreter turns key
  events into commands and owns the waiting `g`, the count and modifier
  handling: a Shift, Ctrl, Alt or Meta keydown on its own changes nothing,
  digits build a count, a `g` waits until answered, Esc, `?` or a click cancel.
  It returns commands such as move by n, go to item n, first, last, act with
  this action, act on all, go to tab kind, step the strip by n, go to strip
  position n, close tab, reopen tab, open, drop the Highlight. A list driver
  applies them to one list through an adapter that each list supplies: the
  items in order, how to find an item's element, how to scroll to it, how to
  open it (Enter) when it can be opened, and the list's word for ticking.
  Posts, Channels, the Directory, a Discovery report and History each provide
  an adapter and stop handling keys themselves. Only one list is mounted at a
  time; the Highlight of each is remembered by list across a tab switch.
- **Keys by position.** The interpreter reads the physical key, so every
  printable key (letters, digits, `?`, `/`, `\`, `-`, `+`, `*`, `,`) works under
  any layout; Esc, Enter and the arrows are read as they are. Lists and
  tooltips show the Latin character.
- **Workspace keys live with the workspace.** The switch, `\`, `?`, `/`, Esc in
  a field, and `g` on a tab without a list are handled at the workspace level;
  on a tab with a list the engine handles `g` itself, since a second `g` is a
  move there.
- **Keyboard mode is one session-scoped switch** shared by every tab, read by
  the workspace (hints, `?`) and the lists alike. The old per-tab session
  flags are dropped; nothing migrates.
- **Help states.** `?` and the shortcuts button move one state machine:
  closed, corner, full. The corner is skipped where it would show nothing (a
  tab without a list, a phone). With keyboard mode off, `?` opens and closes
  the full list on its own and the machine keeps its state for when keyboard
  mode comes back. The full list opens below the header, so a press on the
  shortcuts button that closes it as an outside press must not also count as
  a step.
- **The waiting `g`'s list** sits just above whatever the corner holds (the
  corner list or the pill), styled like the corner list, one key and its
  meaning a row, after a 300 ms delay. A typed count shows its next keys there.
- **Tabs by strip.** `gt` / `gT` and `3gt` act on the strip's order, Fixed tabs
  first; `g` plus a kind's letter goes to that kind's most recent tab, as the
  strip's own go-to does. `gx` never closes a Fixed tab.
- **The Channel spotlight from outside Posts.** Opening a Channel spotlight no
  longer needs a starting Post: Channels' `c` opens one with nothing to scroll
  back to, and `c` in that spotlight returns to Channels with its Highlight.
  The prototype faked a Post for this; the real change gives the spotlight an
  entry that takes only a Channel.
- **The photo viewer.** The Directory's rows, phone cards and panel use the
  Channels tab's avatar in its photo-is-the-button form. The viewer starts on
  the element that was clicked, not the first image with that address. The
  avatar's button never shrinks in a flex row. A key a dialog has already
  taken (Escape closing it) belongs to the dialog, in every list. The viewer
  finds a Directory row to return to on close.
- **Toasts** for `d` and `*` only, naming the action and the item, with Undo
  that presses the same control again. `F` and `D` press the bulk bar's buttons
  and inherit their confirmation (following five or more asks first).
- **Screen readers.** A polite live region announces each move as the item's
  name and its place. `aria-activedescendant` is not used.
- **One marked look.** A ticked Directory entry, a ticked Candidate and a
  selected Channel share a blue tint and edge; Posts keep their dimmed
  deselected state, since every Post starts selected. The Highlight stays the
  2 px blue ring.
- **Header.** Grouped as keyboard (the mode switch, the shortcuts button, the
  command palette), help (the guided tour), then view (full screen, theme).
  The mode switch is an icon button like its neighbours; the shortcuts button
  takes the book-key icon. Both are hidden on phones.

## Testing Decisions

- **Good tests** drive behaviour through the highest seam and assert what the
  person sees: which item is highlighted, which tab is shown, what the
  announcer says, what a toast says. They never assert internal state.
- **The key interpreter**, the one seam every keyboard bug of the prototype
  went through, gets one table-driven test: each row a sequence of real
  keydown events (a capital always preceded by its own Shift keydown, as a
  browser sends it) and the commands it should yield. Rows include `gg`,
  `5gg`, `G`, `23G`, `5j`, `4x` (count dropped), `g3t`, `3gt`, `5gT` and `g5T`,
  `gx` / `gX`, `g` then `?`, `5` then `?`, `g` then Esc, `g` then a click, `gg`
  on a tab without a list, and a Persian-layout row where the key's character
  is not Latin.
- **Each list's adapter** gets a render test with the engine: `j` / `k` move
  the Highlight, Enter opens, the list's action keys press the right control,
  and the announcer speaks. New branching components get render tests, or the
  frontend CRAP ratchet fails.
- **Help** gets a render test of the three states, with keyboard mode off and
  on, and of the waiting `g`'s list.
- **The photo viewer** keeps its unit tests and gains one for opening from the
  clicked element; one Playwright spec covers the Directory: open from a row,
  step to the next row's photo, close, land on that row.
- **Prior art:** the keyboard tests beside `FeedKeyboard`, `ChannelGridKeyboard`
  and `DirectoryKeyboard`, the move tests beside the shared keyboard moves, the
  photo viewer's tests, the workspace shell's tests, and the Directory and
  workspace-tabs Playwright specs.

## Out of Scope

- Discover's Details panel as a side panel that follows the Highlight; it
  stays a modal sheet, so `j` / `k` stop while it is open.
- The Highlight coming back for an item not loaded yet (Channels sorted by
  Last updated can push the remembered Channel off the first page).
- `aria-activedescendant`.
- Keyboard mode on Summary, Chat, Action, Tag, Tools and Settings beyond `g`,
  `\` and `?`.
- Counts on actions (`5x`, `3d`).
- A key that deletes anything.
- Showing strip numbers on the tabs (variant J).

## For implementers

Written for `/implement-spec`: one integration branch, one worktree and branch
per ticket, each ticket built test-first.

- **The task graph is a line**: KM-01, then KM-02, then KM-03. One implementer
  at a time; no ticket runs beside another.

- **Port what a ticket names, rewrite the rest.** The prototype gates every
  change behind `?variant=`, keeps three tab keyboards and translates letters
  at press time; none of that is ported. Never port the variant switch, the
  `directory-photo-prototype` module as it stands, or the Vite `.ts.net` host
  rule.
- **Set up each worktree with `bash scripts/worktree-setup.sh`**; frontend-only
  tickets still run the backend suite, because a new frontend constant without
  a backend constant topic fails the catalog tests.
- **Branch from the integration branch, fetched fresh.**
- **Test a capital with its Shift keydown.** Dispatching `G` alone hid three
  bugs in the prototype; a browser sends `Shift` first.
- **Playwright runs serially** from the worktree's `frontend/`, after `bun
  install` there; without the worktree's config it runs with none and floods
  bogus errors. Mock the API with `page.route` as `tests/directory.spec.ts`
  does; the local app needs a login, so a test that relies on the real backend
  needs the existing helpers. Port 5173 may be another checkout's dev server:
  point Playwright at this worktree's with `PLAYWRIGHT_API_URL`.
- **No backend change is expected.** If one turns up, regenerate the client
  and grep `frontend/tests` for that route's mocks.
- **Run `git` by its absolute path** (`/usr/bin/git`) inside a worktree: a
  shell hook rewrites `git` to a wrapper the worktree guard refuses.
- **Typecheck tests separately** (`bun run typecheck:tests`); the build's
  typecheck skips them.
- **Close a ticket** as `docs/agents/issue-tracker.md` says: `Status: done` and
  a dated comment naming the branch and the merge commit. The integration
  branch's PR lists KM-01, KM-02 and KM-03 as closed.
- **The prototype is reference only.** Read the pinned files a ticket links;
  never merge, rebase onto or cherry-pick from `prototype/directory-photo-viewer`.

## Further Notes

- The work lands as the three tickets above, one PR each. KM-02 carries the
  engine and everything it needs on the three tabs that already have keyboard
  mode (go-to, counts, help, the announcer, Esc in Posts); KM-03 adds the two
  new lists and acting on many.
- Some keys move for people used to the old ones; ADR-034 lists them.
- The prototype's own reading of the Persian layout was never built; the
  interpreter's position-based reading is new code with its own test rows.
