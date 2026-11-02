# Channels skeleton per Card size

The Channels tab's loading skeleton (`ChannelGridBody.tsx`) predates Card size:
eight zoom-0 cards on Tailwind breakpoints, whatever size is stored. At Tiles,
eight big cards turn into about fifteen small tiles a row. The Posts tab already
draws one skeleton per card size (`PostFeedResults.tsx`, RCH-01); this follows it.

## Decisions (grilled 2026-11-02)

1. **One shape per Card size.**
   - Tiles: a 48px circle alone, as the real tile shows only the photo.
   - Compact cards: header (photo, name, handle) and a sync button. No stats, tags or status.
   - Cards: header, bio lines, a stat-tile row, tags, footer with status.
   - Detailed cards: Cards plus the about block and a second schedule line.

   Rejected: a single shape scaled by height, which stays wrong at Tiles.
2. **Columns from `gridLanesForWidth(width, zoom)`**, measuring the grid's
   width as `VirtualizedChannelGrid` does. Rejected: CSS `auto-fill`, which
   drifts from the real grid at Detailed cards (the cap at the Cards count).
3. **Fill about one screen**: rows × lanes, with 2 rows of Cards or Detailed
   cards, 4 of Compact cards, 6 of Tiles. Rejected: a fixed 8.
4. **Cards and Detailed cards take their shape from `cardFace(zoom, settings)`**:
   bio lines only when `face.bio`, `face.statTiles.length` stat bars.
5. **"Card size" is the glossary term** (added to `GLOSSARY.md`); "zoom" is the
   code's name and stays out of prose.
6. **A render test per size**, mutation-checked by forcing one shape for every size.

## Steps

- [x] Prototype: skipped at the user's call (2026-11-02)
- [x] Extract the grid-width measurement so the skeleton and the grid share it (`useGridBox`)
- [x] `ChannelGridSkeleton` in `components/channel-grid/`, used by `ChannelGridBody`
- [x] Render test per size; mutation-check it (seven mutations, all red)
- [x] `bun run lint`, typecheck, `test:unit`
- [x] Screenshots of skeleton and loaded grid at each Card size, shown before merge

## Out of scope

- Skeletons for Card size changes after load (the cards are already there).
