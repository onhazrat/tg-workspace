# KM-02: One Keyboard mode for Posts, Channels and the Directory

**What to build:** Keyboard mode becomes one thing for the workspace. One switch
in the header, left of the command palette and filled while on, or `\` from any
tab (the shortcuts list open included), turns it on and off for every tab; it
lasts the browser session. Every key means one action wherever that action
exists, by ADR-034's list, and every printable key is read by its position, so
the keys work with a Persian layout active. Posts, Channels and the Directory
stop handling keys and plug into one engine.

On those three tabs: `j` / `k`, `gg` / `G`, counts on moves (`5j`, `37G`, `5gg`;
a count before any other key is dropped), Esc drops the Highlight (Posts too),
each tab keeps its Highlight across a tab switch, `-` / `+` resize cards
(Channels' four sizes, Posts compact or full), `m` opens or closes a Post's
text or a Channel's bio and `M` every Post's, `c` shows the Highlight's Channel
alone in Posts and back, and from Channels opens it in Posts and back to
Channels, `/` puts the cursor in the tab's search box and Esc in a field gives
the keys back. Each control with a key shows it in its tooltip, and `x`'s label
says the tab's word (Tick in the Directory, select on Channels, Pick in Posts).

From any tab: `g` then a letter goes to a tab (`p c d v a s l m h o ,`); `gt` /
`gT` step through the strip, wrapping, and `3gt` / `g3t` go to the third tab,
`5gT` / `g5T` five back; `gx` closes the tab unless it is a Fixed tab, `gX`
reopens the last closed. A `g` waits until answered; Esc, `?`, a click or a key
it does not answer cancels it, as they cancel a count.

Help: `?` and the header's shortcuts button (the book-key icon) step from
nothing, to the tab's keys in the bottom-left corner, to the full list, and
back; the corner is skipped where it would show nothing. With keyboard mode
off, `?` opens and closes the full list on its own and every hint hides,
coming back as it was when keyboard mode returns. A small pill ("keyboard mode
· ? keys · \ off") marks the corner otherwise. After 300 ms, a waiting `g` or a
typed count lists the keys it leads to just above whatever the corner holds,
styled like the corner list. The full list is sentence case with keys as
typed, opens below the header and scrolls within the window. The header
groups keyboard (the switch, the shortcuts button, the command palette), then
the guided tour, then full screen and theme; the switch and the shortcuts
button are hidden on phones.

Each move is announced to a screen reader through a polite live region: the
item's name and its place ("@name, 6 of 20").

**Blocked by:** KM-01 (both change the Directory's table and the photo
viewer's keys).

**Building it in one context:** this is the largest ticket, kept whole to keep
review and testing overhead low. Build it test-first in this order, each step
green before the next, so a fresh context can resume from the last commit:

1. The key list and the pure interpreter with its table of key sequences
   (keys by position, the waiting `g`, counts, modifiers, cancelling). No UI.
2. The list driver and the Directory's adapter, replacing the Directory's own
   key handling; the Directory keyboard tests keep passing.
3. Channels' and Posts' adapters, replacing theirs; then `-` / `+`, `m` /
   `M`, `c` both ways, the Highlight across tabs, Esc in Posts.
4. The workspace: the session switch in the header and `\`, `/` and Esc in a
   field, `g` letters and the strip keys from tabs without a list.
5. Help: the three steps for `?` and the shortcuts button, the pill, the
   corner list, the waiting `g`'s list, the full list's look, the header's
   grouping; tooltips and `x`'s per-tab word; the announcer.

**Status:** done

**Context pointers:** spec `../spec.md` (Implementation Decisions: the key list,
the engine in two parts, keys by position, workspace keys, the session switch,
help states, the waiting `g`'s list, tabs by strip, the Channel spotlight from
outside Posts, screen readers, header), ADR-034, `../prototype.md` (read "What
the prototype got wrong" first). Prototype at a6aa1eb6; these show the
behaviour, not the structure to keep (the prototype has three keyboards and
translates letters at press time):

- [keys.ts](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory-photo-prototype/keys.ts): the action list and each tab's actions, help states, the Highlight memory, go-to and the strip keys, the Channels-to-Posts spotlight, the workspace's keys.
- [fkeys.ts](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory-photo-prototype/fkeys.ts): counts, the shared waiting `g` and `gLive`, `stepIndex`, the announcer.
- [variant.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory-photo-prototype/variant.tsx): the shared keyboard mode store and `\`.
- [KeyHelp.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/KeyHelp.tsx): the pill, the corner list, `CornerGoKeys` (variant H's list above the corner).
- [App.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/App.tsx) and [WorkspaceShellParts.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/workspace-shell/WorkspaceShellParts.tsx): the header's order and buttons, `?` and the shortcuts button, the full list's sections and look, the strip operations handed to the keys.
- [FeedKeyboard.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/post-card/FeedKeyboard.tsx), [ChannelGridKeyboard.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/channel-grid/ChannelGridKeyboard.tsx), [DirectoryKeyboard.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory/DirectoryKeyboard.tsx): what each list's adapter must provide.
- [PostCardBody.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/post-card/PostCardBody.tsx): the more or less buttons with `aria-expanded`.
- Today's code it builds on: the workspace tab strip's operations (go to a kind, open, close, reopen the last closed), the Channel spotlight state, the shortcuts dialog, `useSessionFlag`.
- Prior-art tests: `FeedKeyboard.test.tsx`, `ChannelGridKeyboard.test.tsx`, `DirectoryKeyboard.test.tsx`, `keyboard-moves.test.ts`, `WorkspaceShell.test.tsx`, `tests/workspace-tabs.spec.ts`.

- [ ] One key list names every action, its key and each tab's label; the controls carry the list's key, and nothing translates letters at press time.
- [ ] A pure key interpreter, tested by one table of real keydown sequences (every capital preceded by its own Shift keydown), yields the right command for: `gg`, `5gg`, `G`, `23G`, `5j`, `7k`, `4x` (count dropped), `g3t`, `3gt`, `5gT`, `g5T`, `gx`, `gX`, `g` then `?`, `5` then `?`, `g` then Esc, `g` then a click, `gg` on a tab without a list, `g` then a letter, and a Persian-layout row.
- [ ] Posts, Channels and the Directory each plug into the engine through an adapter and handle no keys themselves; a render test per tab covers `j` / `k`, a count, `gg` / `G`, Esc, one action key and the announcer.
- [ ] One session-scoped switch, the header's icon button and `\`, turns keyboard mode on and off for every tab; the old per-tab flags are gone.
- [ ] The Highlight of each tab comes back after a tab switch when its item is loaded.
- [ ] `-` / `+`, `m` / `M`, `c` (both ways, from Posts and from Channels), `/` and Esc in a field work as described; the Channel spotlight opens from a Channel alone, with no Post.
- [ ] `g` plus every letter, `gt` / `gT` with and without counts, `gx` on Closable and Fixed tabs, and `gX` work from every tab.
- [ ] The help steps (closed, corner, full) work from `?` and the shortcuts button, with keyboard mode on and off; the full list opens below the header and a press on the shortcuts button closes it without counting twice.
- [ ] The waiting `g`'s and a count's list appears after 300 ms above the corner's contents.
- [ ] Every control with a key names it in its tooltip in keyboard mode; `x` says Tick, select or Pick by tab.
- [ ] The live region announces each move.
- [ ] The full list is sentence case with keys as typed; the header is grouped; the switch and the shortcuts button are hidden on phones.
- [ ] The build and test typechecks pass, the backend suite passes (a new frontend constant needs its backend topic), and a render test covers each new branching component.

## Comments

- 2026-10-22: implemented on `claude/km-02-one-keyboard-mode` and merged into the integration branch in 0f613fbb (fast-forward).
  Open: nothing in scope; J / K, F / D, toasts and the one marked look are KM-03's.
