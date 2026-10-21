# The Directory photo viewer and one Keyboard mode: prototype

Code: [`prototype/directory-photo-viewer` @ a6aa1eb6](https://github.com/onhazrat/tg-workspace/tree/a6aa1eb6ecbef4886a48817d6228344d6ed64778),
one commit on top of `main` at e5c49003. The prototype's own pieces are
`frontend/src/components/directory-photo-prototype/`.

Status: resolved

Built 2026-10-21 and 2026-10-22, on staging's data through a local frontend,
to answer two questions. Can the Directory open the Channels tab's photo
viewer with the Channels tab's own components? It can, with three fixes. What
should keyboard mode be once it is one thing for the workspace? Variant H; the
answer is ADR-034 and `docs/keyboard-mode-plan.md`.

## Variants (`?variant=`, every tab)

Each builds on the one before; `since(variant, from)` gates by that order.

| Key | Idea |
|---|---|
| 0 | `main`, unchanged |
| B | The Directory photo viewer; one shared keyboard mode with one meaning per letter; `\`; `?` in three steps; highlight kept across tabs; `-` / `+`; `c` toggles the spotlight; `p` / `h` / `l` in the viewer |
| C | B, and `/`, Esc in a field, `g p` / `g c` / `g d`, `c` from Channels into Posts and back, `J` / `K`, one look for marked items |
| D | C, and Discover's keyboard mode, `g` plus a letter from every tab, `gt` / `gT` / `gx` / `gX`, the header switch |
| E | D, and History's keyboard mode |
| F | E, and counts, the waiting `g`'s list, `J` / `K` following the last `x`, `F` / `D`, toasts with Undo, Esc in Posts, the announcer, `m` / `M`, vim counts on `gt` / `gT` |
| **H** | **F, with the waiting `g`'s list above the corner list (chosen)** |
| J | F, with the `g` letters and strip numbers as badges on the tabs |

The pink bar at the bottom of the Directory tab switches variants (← / →).
The variant is a module value read by `useVariant()` and `variantNow()`, and
the root carries it as `data-variant` for CSS.

## What is real and what is stubbed

Nothing is stubbed: every key presses the app's real control against the
staging API. Testing intercepted `HTMLElement.prototype.click` for Follow,
Dismiss, Freeze and selection so no account data changed.

## File map

| File | Holds |
|---|---|
| `directory-photo-prototype/variant.tsx` | The variants, `since`, the shared keyboard mode store, `useKeyboardMode`, the switcher |
| `directory-photo-prototype/keys.ts` | The key list (`ACTIONS`, `CONTROLS`, `controls()`), `controlKey` / `keyFor`, help states, the highlight memory, go-to (`goAfterG`, `STRIP`, `GO_D`), the Channels-to-Posts spotlight, `useWorkspaceKeys` |
| `directory-photo-prototype/fkeys.ts` | F: counts (`prefixKey`, `takeCount`, `stepIndex`), the shared waiting `g` (`gLive`), `ensureSelection`, `bulkKey`, toasts (`pressControl`), the announcer |
| `KeyHelp.tsx` | The pill, the corner list, `CornerKeys`, the waiting `g`'s list (`GoPopup`, `CornerGoKeys` for H, `TabBadges` for J) |
| `lib/keyboard-moves.ts` | `readMove` with the waiting `g` and modifiers; `keyBelongsElsewhere` with a key a dialog took |
| `post-card/FeedKeyboard.tsx`, `channel-grid/ChannelGridKeyboard.tsx`, `directory/DirectoryKeyboard.tsx` | The three tab keyboards, each wired to the above |
| `post-card/PhotoViewer.tsx`, `ChannelAvatar.tsx` | The viewer's `from` element, `h` / `l` / `p`, the button that never shrinks, the Directory row as a return target |
| `directory/DirectoryTable.tsx`, `directory/DirectoryPanel.tsx` | Avatars as the button; the panel's photo as its own gallery |
| `DiscoverView.tsx`, `discover/DiscoverCandidateTable.tsx`, `HistoryView.tsx`, `history/ArtifactCardParts.tsx` | Discover's and History's lists on the Directory's keyboard (`tab` parameter) |
| `App.tsx`, `workspace-shell/WorkspaceShellParts.tsx` | The header's buttons and order, the switch, `?` and the shortcuts button, the full list's sections and look |

## What the prototype got wrong

The spec and tickets say the right thing; port none of these.

- **Three keyboards.** Each tab handled keys itself, so the waiting `g`, the
  count and Shift were fixed three times and broke three times (`gT`, `23G`,
  `gg`, `?` not cancelling). The spec's one interpreter replaces them.
- **Letters translated at press time.** Controls kept their old letters in
  `data-shortcut`, and `controlKey` mapped the list's key to them. The real
  controls carry the list's key.
- **Keys by character.** Nothing works on a Persian layout.
- **A faked Post** opens the Channel spotlight from Channels.
- **`x` says "select" everywhere**, against the glossary's Tick and Pick.
- **Toasts for `x` and `J` / `K`** as well as `d` and `*`; the decision is `d`
  and `*` only.
- **One marked look switched on for variants C and D only.** The CSS names
  those two, so E, F, H and J never show it. The decision keeps the look.
- **Tooltips name keys on Posts only.**
- **Help hides in the corner by measuring the DOM** (`[data-corner-hint]`) to
  stack the waiting `g`'s list; fine for a prototype, a layout slot in the
  real thing.
- Once, during testing, the browser landed on a Channel's Telegram page as
  `o` would send it, with no `o` pressed. It did not happen again; worth a
  look if it recurs.
