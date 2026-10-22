# ADR-034: One Keyboard mode, one meaning per key

**Status:** Accepted (2026-10-22). Plan: `docs/keyboard-mode-plan.md`.
Prototype: variant H on [`prototype/directory-photo-viewer` @ a6aa1eb6](https://github.com/onhazrat/tg-workspace/tree/a6aa1eb6ecbef4886a48817d6228344d6ed64778).

## Context

Posts (PTR-02), Channels (CARD-05) and the Directory (DFP-01) each grew their
own Keyboard mode: their own switch, their own legend and their own copy of
the moves. The letters disagreed. `f` showed one Channel alone in Posts, froze
a Channel on the Channels tab and followed one in the Directory; `t`
translated a Post but tagged a Channel. Each tab's code carried the same
moves, so every fix to them had to land three times, and the prototype's bugs
(a Shift keydown cancelling a pending `g`, a count lost to the same Shift, `?`
leaving a `g` waiting) were each one bug in three places.

Moving the Directory's avatars onto the photo viewer brought the question to a
head: the Channels tab's `p` had to mean the same in the Directory, and once
one key was shared, all of them were.

## Decision

- **One Keyboard mode for the workspace.** One switch, in the header beside the
  command palette, and `\`, turn it on and off for every tab. It lasts the
  browser session. Its hints hide while it is off and come back as they were.
- **One meaning per key.** One list names every action and its key, and each
  tab offers the actions it has: `x` Tick, select or Pick (the tab's own
  word), `f` follow, `d` dismiss or take back, `t` tag, `o` open in Telegram,
  `p` view the photo, `s` sync, `z` freeze, `c` the Channel spotlight, `y` copy
  link, `l` translate, `r` find related, `m` more or less, `*` star, `n` note.
  A capital is that key with Shift: `G` goes to the last item, `J` and `K` move
  while ticking, `F` and `D` act on everything ticked, `M` opens or closes
  every Post.
- **vim's moves.** `j` and `k`, `gg` and `G`, and counts on moves only: `5j`,
  `37G`. `g` then a letter goes to a tab; `gt` and `gT` step through the strip,
  `3gt` goes to the third tab and `5gT` five back, as in vim. A count before
  any other key is dropped.
- **Keys by position.** Every printable key is read by where it sits, so the
  keys work with a Persian layout active. The lists show the Latin letters.
- **One engine.** Every list (Posts, Channels, the Directory, a Discovery
  report, History) plugs into one keyboard engine that holds the Highlight, the
  pending `g` and the count. A tab says what its items are and how to reach
  them; it does not handle keys.
- **Three steps of help.** `?` and the header's shortcuts button step from
  nothing, to the tab's keys in the corner, to the full list. While a `g`
  waits, the keys it leads to show just above the corner.
- **The photo viewer keeps its own keys.** While it is open it holds the keys:
  `h` and `l` step photos, `p` closes it. Nothing on the page can fire then, so
  they cannot clash with `l` translate or `p` view.

## Alternatives considered

- **Keep a keyboard per tab** and only align the letters. Rejected: the moves
  and the pending state are where every bug lived, and three copies drift.
- **Browser conventions** (Ctrl+Tab, numbers for tabs). Rejected: Ctrl is the
  browser's, and keyboard mode already speaks vim (`j`, `k`, `gg`).
- **Counts for actions** (`5x`, `3d`). Rejected: a mistyped digit would
  dismiss five Channels instead of one.
- **Keys by character.** Rejected: on a Persian layout `j` types `ت`, and
  nothing fires.
- **Delete on a key** in History. Rejected: one wrong key would lose an
  Artifact; delete stays on the mouse.

## Consequences

- Some keys move. Freezing a Channel is `z`, not `f`; showing a Channel alone
  in Posts is `c`, not `f`; copying a Post's link is `y`, not `c`; translating
  is `l`, not `t`; a Channel's bio is `m`, not `b`.
- A new action takes a key from the one list, so a clash is caught there.
- A key's meaning is checked once, in the engine's tests, with real key
  sequences (the Shift keydown included), not three times.
- Discover's Details panel still covers the page, so `j` and `k` stop while it
  is open; making it a side panel is a separate change.

## Deviations in the build

- Undo after Discover's `d` and History's `*` sets back the state the item had,
  rather than pressing its control again. A dismissed Candidate leaves the
  default view and an unstarred Artifact leaves "Starred only", so there is
  often no control left to press.
- History's star toast now names the Artifact and offers Undo for a mouse click
  too. It replaced "Item starred.", so the key and the click say the same
  thing.
