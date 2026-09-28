# Channel card zoom levels

Status: ready-for-agent

Ticket prefix: `ZOOM`.

Settled in a grilling session on 2026-09-28. No ADR: every decision here is presentation and
reverses cheaply. Zoom level is not a domain term and stays out of `CONTEXT.md`.

## Problem Statement

The Channels tab shows every followed Channel as a large card, at most four per row. An account
follows about a thousand Channels. Picking forty of them for a bulk action (tag, freeze, move to a
setting group, sync) means scrolling through tall cards and hitting a small round checkbox in the
corner of each. It is one click per Channel, with nothing faster than All / None / Revert and search.

The other direction is missing too. The per-field `showChannel*` settings hide the Channel counters,
the bio, the Telegram chat ID and the Start ID. Seeing them for a moment means going to Settings,
turning each one on, and turning it back off afterwards.

## Solution

Two icon buttons on the Channels tab toolbar step the cards through four zoom levels:

- **+1 (detailed)** is today's card with every optional field shown, whatever the settings say.
- **0 (normal)** is today's card, unchanged.
- **-1 (compact)** shows only the avatar, name, @handle and the Sync button. The whole card, except
  the Sync button, is a selection toggle.
- **-2 (avatars)** shows only the avatar. The whole tile is a selection toggle.

Compact levels pack more cards per row. Shift-click selects or deselects a run of Channels at every
level. The chosen level is remembered.

## User Stories

1. As a user managing many Channels, I want to zoom the channel cards out, so that I can see many
   more Channels on one screen.
2. As a user, I want to zoom the cards in past normal, so that I can see every counter and field
   without changing my settings.
3. As a user, I want the zoom buttons always visible in the top toolbar, so that I can change
   density before anything is selected.
4. As a user, I want the zoom-out button disabled at the most compact level, and the zoom-in button
   disabled at the most detailed level, so that I can tell I am at the end of the range.
5. As a user, I want each zoom button to name what it does in a tooltip ("Compact cards", "Detailed
   cards"), so that I don't have to guess which way an icon goes.
6. As a user, I want the zoom level remembered when I come back to the tab or reload the page, so
   that I don't re-pick it every visit.
7. As a user of two accounts in one browser, I want each account to remember its own zoom level, so
   that one account's choice does not leak into the other's.
8. As a user at normal zoom, I want my `showChannel*` settings to behave exactly as they do today,
   so that the feature changes nothing I didn't ask for.
9. As a user at detailed zoom, I want the bio, subscribers, Telegram chat ID, photo, video, file and
   link counters and the Start ID all shown, so that I can compare Channels on every figure at once.
10. As a user at detailed zoom, I want my `showChannel*` settings left untouched, so that going back
    to normal restores my usual card.
11. As a user at compact zoom, I want to see each Channel's avatar, display name and @handle, so
    that I can still recognise and tell apart every Channel.
12. As a user at compact zoom, I want the Sync button kept, so that I can sync one Channel without
    zooming back in.
13. As a user at compact zoom, I want the syncing overlay, the frozen mark, the sync-queue position
    and the Unavailable badge kept, so that I can see why Sync is busy or disabled.
14. As a user at compact zoom, I want stats, tags, language, partial-history and sort-rank badges and
    the hover freeze/reset/remove bar hidden, so that the card stays small.
15. As a user at compact zoom, I want clicking anywhere on a card except Sync to toggle its
    selection, so that I don't have to hit a small checkbox.
16. As a user at compact zoom, I want clicking Sync to sync without toggling selection, so that
    syncing one Channel does not disturb the selection I built.
17. As a user at compact zoom, I want the checkbox gone, so that the card has one selection
    affordance, not two.
18. As a user at avatar zoom, I want each Channel shown as its avatar alone, so that I can fit a
    whole account's Channels on a screen or two.
19. As a user at avatar zoom, I want clicking a tile to toggle its selection, so that picking
    Channels is one click each.
20. As a user at avatar zoom, I want a selected tile to carry the same ring a selected card does, so
    that selection reads the same at every level.
21. As a user at avatar zoom, I want a syncing Channel to show a spinner over its avatar, so that I
    can see sync activity without a progress bar.
22. As a user at avatar zoom, I want a frozen Channel's avatar dimmed, so that I can spot frozen
    Channels in a wall of avatars.
23. As a user at avatar zoom, I want hovering a tile to show the display name and @handle, so that I
    can identify two Channels with similar avatars.
24. As a user at compact or avatar zoom, I want the grid to put more cards on each row, so that the
    smaller cards don't sit in wide empty columns.
25. As a user at detailed zoom, I want wider cards, and so fewer per row if needed, so that the extra
    chips have room.
26. As a user on a narrow window, I want the column count to follow the space available at every
    zoom level, so that cards never overflow or squash.
27. As a keyboard user at compact or avatar zoom, I want each card to be focusable and toggled with
    Enter or Space, and announced as a pressed or unpressed toggle, so that I can select without a
    mouse.
28. As a user, I want a card that is syncing to still toggle selection when clicked, so that the
    overlay does not block picking it.
29. As a user at normal or detailed zoom, I want clicking the card body to do nothing new, so that
    editing tags or the Start ID never selects the Channel by accident.
30. As a user at any zoom level, I want shift-click to select every Channel between the last one I
    clicked and this one, so that I can pick a run in two clicks.
31. As a user at normal or detailed zoom, I want shift-click on the checkbox to extend the range, so
    that range select works where the checkbox is the selection control.
32. As a user, I want a shift-clicked run to take the state the clicked Channel is moving to, so
    that the same gesture can select a run or deselect one.
33. As a user, I want a shift-click to leave selections outside the run untouched, so that it never
    throws away a selection I built by search and All.
34. As a user, I want the anchor to be the last Channel I clicked, plain or shift, so that chained
    shift-clicks walk forward from where I last was.
35. As a user, I want All, None and Revert to leave the anchor where it is, so that they don't
    change what my next shift-click means.
36. As a user, I want "between" to mean the order on screen now, so that a run after I change the
    sort or search matches what I see.
37. As a user, I want a shift-click to act as a plain toggle when the anchor is no longer on screen,
    so that it never selects Channels I can't see.
38. As a user, I want a shift-clicked run to include frozen and Unavailable Channels, so that it
    matches clicking each one and works for freeze, tag, move and delete.
39. As a user, I want shift-click not to highlight the card text, so that range select looks clean.
40. As a user, I want the command palette's channel actions to find cards at every zoom level, so
    that zooming out doesn't break them.

## Implementation Decisions

- **The zoom level is a settings-schema entry.** It is a new key beside the `showChannel*` keys,
  with integer values -2 to +1 and a default of 0. Like those keys it has no backend section, so
  it persists through the scoped browser storage the settings store already uses: per account,
  per browser. It is read and written through the settings context, never through storage directly.
- **Card faces per level are one pure function.** Given the zoom level and the `showChannel*`
  settings, it returns which parts of the card to render. The parts are the header (avatar, name,
  @handle), bio, each meta chip, tags, footer status and Start ID, the Sync button, the checkbox,
  the hover action bar, and each badge. It also returns whether the card body is a selection toggle.
  At +1 it overrides all eight `showChannel*` flags to true. At 0 it passes them through. At -1 and
  -2 it hides everything the design drops. `ChannelCard` asks this function instead of reading the
  settings field by field.
- **Avatar zoom is its own small card face.** It is not level -1 with more parts turned off. At -2
  the frame, padding and layout differ (square tile, avatar filling it, spinner and dimming on the
  avatar itself), so a separate compact face component is simpler than threading conditionals
  through the full card. Levels -1, 0 and +1 share the existing card assembly.
- **Selectable cards are a toggle button, not a clickable div.** At -1 and -2 the card body is
  exposed as a toggle (`aria-pressed`, focusable, Enter and Space). At -1 the Sync button sits above
  the toggle rather than inside it, because a button inside a button is invalid markup. Sync stops
  the click from reaching the card, as the existing action buttons already do. The
  `data-channel-name` attribute stays on the card root at every level, because the command palette
  and the e2e suite locate cards by it.
- **The grid's column count derives from a minimum card width per zoom level.** The breakpoint
  function that maps container width to 1-4 columns gains the zoom level as an input. It returns
  `floor(width / minCardWidth)`, clamped to at least one column. Starting widths are about 360px at
  +1, about 220px at -1 and about 72px at -2, tuned by eye. Level 0 keeps today's column counts at
  today's breakpoints exactly. The fixed four-column maximum is gone. The virtualised grid
  re-measures rows when the zoom level changes, as it already does when the column count changes,
  and its starting row-height estimate depends on the level.
- **Range selection is one pure function.** Its inputs are the current selection, the Channel
  handles in on-screen order, the anchor handle (or none), the clicked handle, and whether shift is
  held. It returns the new selection and the new anchor. Rules:
  - A plain click toggles the clicked Channel.
  - A shift-click with the anchor on screen sets every Channel from the anchor to the clicked one,
    both ends included, to the clicked Channel's new state.
  - A shift-click with no anchor, or with the anchor off screen, behaves as a plain click.
  - The new anchor is always the clicked Channel.
  - Channels outside the range are untouched.
  - Frozen and Unavailable Channels are not special.
- **The anchor lives in the channel grid, beside the selection.** It is not in `DataContext`,
  whose field set is pinned. The grid passes one selection callback down to each card, carrying the
  clicked handle and whether shift was held. The existing checkbox (levels 0 and +1) and the new
  card toggle (levels -1 and -2) both call it. The on-screen order is the grid's filtered and sorted
  list, the same one it renders. Every Channel between two clicked ones is already revealed by
  load-more, so the range never reaches an unrendered card.
- **The shift-click text-selection side effect is suppressed** on the selection controls only, so
  tag and Start ID text stays selectable.
- **The zoom control** is two icon buttons at the right end of the always-visible toolbar, after
  Sync All. It is not placed in the bulk-action bar, which renders only while something is selected.

## Testing Decisions

- A good test here asserts what a user sees or gets: which parts a card shows at a level, which
  Channels end up selected, how many columns a width yields. It does not assert which component or
  prop produced it. The pure functions below carry the rules, so the rules can be pinned without
  context providers or `mock.module`, which is process-wide in bun.
- **Range selection function, unit tests.** Cover a plain toggle, selecting a run forward and
  backward, deselecting a run, a run leaving outside selections untouched, the anchor off screen,
  no anchor, anchor equal to the clicked Channel, and the anchor moving on every click. Prior art:
  the trim-selected-channels and selected-trim-ranks tests.
- **Columns-per-zoom function, unit tests.** Level 0 reproduces today's breakpoint table exactly
  (the existing grid-lanes test stays green unchanged, which proves no regression). Compact levels
  yield more columns than normal at the same width, detailed yields no more, and a width below one
  card still yields one column. Prior art: the grid-lanes test.
- **Card-face function, unit tests.** +1 shows every optional field with every `showChannel*`
  setting off. 0 mirrors the settings one to one. -1 keeps exactly the header, Sync, syncing
  overlay, frozen mark, queue badge and Unavailable badge, and makes the body a toggle. -2 keeps
  the avatar only. Prior art: the channel-card-status tests in the card test file.
- **One Playwright journey** in the channels spec pins the wiring the pure functions cannot:
  - The zoom buttons step through all four levels and disable at the ends.
  - At -1 a card click selects and a Sync click does not.
  - At -2 a tile click selects.
  - Shift-click selects a run at 0 (on the checkbox) and at -2 (on the tile).
  - The level survives a reload.
  Run it serially, like the rest of that spec.
- Mutation-test each new unit test before trusting it: break the function and watch the test go
  red.

## Out of Scope

- Keyboard shortcuts or ctrl+scroll for zooming.
- Syncing the zoom level to the server across devices. It stays per account, per browser, like the
  `showChannel*` settings.
- Zoom levels anywhere other than the Channels tab, such as Discover or the post feed.
- Ctrl/cmd-click semantics, or dragging a marquee to select.
- Showing the zoom level as a number.

## Further Notes

- The selection ring at -2 must reuse the frame class the selected card already uses, so a style
  change to one reaches both.
- An earlier grilling answer said the level "follows the account". Precisely, it follows the account
  in one browser, because the `showChannel*` keys it sits beside have no backend section.
