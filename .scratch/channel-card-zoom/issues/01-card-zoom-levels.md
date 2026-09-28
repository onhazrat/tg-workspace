# ZOOM-01: Four channel card zoom levels

**What to build:** Two icon buttons at the right end of the Channels tab toolbar, "Compact cards" and
"Detailed cards", step the channel cards through four zoom levels. Level 0 is today's card. +1 forces
every `showChannel*` field on. -1 shows avatar, name, @handle and Sync, and clicking the card
anywhere but Sync toggles selection. -2 is an avatar tile that toggles selection when clicked.
Compact levels put more cards on each row. The level is remembered per account in the browser. See
`.scratch/channel-card-zoom/spec.md`, user stories 1-29 and 40.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

### Setting and control

- [ ] A new settings-schema entry beside the `showChannel*` keys holds the zoom level: integers -2 to +1, default 0, no backend section. It is read and written only through the settings context
- [ ] Two icon buttons after Sync All in the always-visible toolbar, with tooltips "Compact cards" and "Detailed cards". Zoom-out is disabled at -2 and zoom-in at +1. No level number is shown
- [ ] The level survives a reload and is namespaced per account like the other settings

### Card faces

- [ ] One pure function maps the zoom level and the `showChannel*` settings to the parts a card renders, plus whether the body is a selection toggle. `ChannelCard` asks it instead of reading settings field by field
- [ ] +1 shows bio, subscribers, Telegram chat ID, photos, videos, files, links and Start ID even with every setting off, and writes no setting
- [ ] 0 renders exactly today's card. The existing card tests pass unchanged
- [ ] -1 keeps the avatar, display name, @handle, Sync button, syncing overlay, frozen mark, queue `#n` badge and Unavailable badge. It drops the checkbox, every stat chip, tags, bio, footer status and Start ID, the language, partial-history and sort-rank badges, and the hover freeze/reset/remove bar
- [ ] -2 is its own compact face: an avatar tile, the selected card's ring (reusing the same frame class), a spinner over the avatar while syncing, a dimmed avatar when frozen, and a tooltip with display name and @handle
- [ ] `data-channel-name` stays on the card root at every level, so the command palette still finds cards

### Click to select at -1 and -2

- [ ] The card body is a focusable toggle with `aria-pressed`, working with Enter and Space
- [ ] At -1, Sync sits above the toggle rather than inside it (no nested buttons), and a Sync click never changes the selection
- [ ] Clicking a syncing card still toggles its selection
- [ ] At 0 and +1, clicking the card body still does nothing

### Grid density

- [ ] The column-count function takes the zoom level as well as the container width. Level 0 returns today's breakpoint table exactly. Other levels use `floor(width / minCardWidth)`, at least one column, starting from about 360px at +1, 220px at -1 and 72px at -2. Tune by eye in the running app
- [ ] The virtualised grid re-measures rows when the zoom level changes, and its starting row-height estimate depends on the level

### Tests

- [ ] Unit tests for the card-face function: +1 with every setting off, 0 mirroring settings one to one, the exact -1 keep list, -2 avatar only, body-is-toggle only at -1 and -2
- [ ] Unit tests for columns per zoom: level 0 matches the existing table (the grid-lanes test passes unchanged), compact levels give more columns than 0 at the same width, +1 gives no more, and a very narrow width gives one
- [ ] Mutation-test each new unit test: break the function and watch the test go red
- [ ] Playwright journey in the channels spec (run serially): the buttons step through all four levels and disable at the ends; at -1 a card click selects and a Sync click does not; at -2 a tile click selects; the level survives a reload
- [ ] Frontend lint, typecheck and unit tests pass
