# CARD-05: Keyboard mode on the Channels tab, and gg/G on the Posts tab

**What to build:** An Account can work through the Channels grid without the mouse, with the same
keys as the Posts tab, and both tabs gain `gg` and `G`. See `.scratch/channel-cards/spec.md`:
user stories 50 to 67, and the implementation decisions on keyboard mode.

**Blocked by:** CARD-02, CARD-03, CARD-04

**Status:** ready-for-agent

The prototype (`prototype/channel-cards`) shows the behaviour on every variant. Moving is a pure
function of the current index, the move and the count; the highlight is a Channel name held in
state because the grid unmounts cards scrolled out of range. The session-flag hook and the key
legend become shared with the Posts tab.

- [ ] A Keyboard switch next to the card-size switch turns keyboard mode on for the browser session, per Account, like the Posts tab's
- [ ] `j` and `k` move the highlight one Channel in reading order whatever the column count; the first press starts at the first row on screen; nothing moves past either end
- [ ] `G` moves to the last loaded Channel and `gg` (two presses within 600 ms) to the first
- [ ] Moving scrolls the grid so the highlighted row is centred, including to a row that was not mounted
- [ ] `x` selects or deselects, `s` syncs, `t` focuses the tag field, `f` freezes or unfreezes, `o` opens in Telegram, `b` toggles the bio and `p` opens the photo, each by pressing the highlighted card's own control; Escape drops the highlight
- [ ] Tiles and compact cards answer `x`, `s`, `o` and `p`; cards and detailed cards answer all seven
- [ ] The key legend lists only the keys the current card size supports, read from the same description of the size the cards use
- [ ] Keys are ignored with a modifier held, while a field has focus, or while a dialog (the photo viewer included) is open
- [ ] Reset and Remove have no key
- [ ] The Posts tab's keyboard mode gains `gg` and `G`, with a test
- [ ] The Channels end-to-end spec drives `j`, `gg`, `x` and `o`, and checks the legend changes with the card size
- [ ] The frontend CRAP ratchet passes, and every new or changed test is mutation-checked
