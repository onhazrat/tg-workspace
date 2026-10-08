# CARD-02: Stat tiles, aligned rows, and bios at two lengths

**What to build:** Cards and detailed cards show their numbers as a grid of stat tiles that has the
same slots on every card, and each section of a card starts level with the same section on the
cards beside it. See `.scratch/channel-cards/spec.md`: user stories 16 to 30, and the
implementation decisions on stat tiles, In scope, aligned rows and the bio.

**Blocked by:** CARD-01

**Status:** done

The header stays today's: photo, title and handle at today's size, with the Language, sort rank
and partial history badges at the top left. The prototype (`prototype/channel-cards`,
`?variant=E`) shows the tiles and the alignment; the prototype shows detailed bios whole, and the
spec cuts them at about four lines instead.

- [ ] A card shows tiles for Posts, In scope, Reach and Per hour, then Subscribers and the four media counters (photos, videos, files, links) when the Account's card settings show them; a detailed card shows every tile whatever the settings
- [ ] A tile that is shown always renders; a Channel with no value shows a dash, so every card in the grid has the same tiles in the same order
- [ ] Each tile is a big number over a small label, in the app's compact count format, with the exact value in a hover hint
- [ ] Reach shows a tilde when it is an estimate, and a dash with "not measured" in the hint when absent
- [ ] In scope shows the Channel's in-scope count (zero included) when the Channel is among the Scope's selected Channels, the Hidden selection counting as selected, and a dash with the hint "not selected" otherwise
- [ ] A detailed card adds an About line with the chat id when shown, the date the Channel was followed and the Channel it was auto-followed from, each only when known
- [ ] A card's bio is cut at two lines and a detailed card's at about four, each with a More/Less toggle that appears only when text is hidden, and is measured again when the card's width changes
- [ ] Header, bio, tiles, tags, the About line and the footer each start level with the same section on every card in the row; a section a card lacks takes no height of its own beyond the row's; tiles and compact cards are unaffected
- [ ] The Channels end-to-end spec checks the alignment by comparing element positions across a row of cards with bios of different lengths
- [ ] The frontend CRAP ratchet passes, and every new or changed test is mutation-checked

## Comments

- 2026-10-08: implemented on `worktree-agent-a417f11fae8f6f613` and merged into the integration branch in 3b3e9e49. The row grid gap is column-only so no row gap falls between subgrid sections; `showChannelTelegramChatId` now matters only on the detailed card's About line.
