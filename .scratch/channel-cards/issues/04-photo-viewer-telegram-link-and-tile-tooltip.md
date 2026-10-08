# CARD-04: Channel photo viewer, Telegram link and tile tooltip at every size

**What to build:** A Channel's photo can be opened full screen from any card size, "Open in
Telegram" is in the same place at every size, and a tile's name appears in the app's tooltip.
See `.scratch/channel-cards/spec.md`: user stories 43 to 49, and the implementation decisions on
the photo viewer, the Telegram link and the tile tooltip.

**Blocked by:** CARD-01

**Status:** ready-for-agent

The viewer is the Posts tab's, unchanged in behaviour. The prototype (`prototype/channel-cards`,
`?variant=E`) shows it at every size, with the magnifier at the tile's bottom right; the spec
moves the magnifier to the bottom left so the Telegram link can sit at the bottom right everywhere.

- [ ] Clicking a Channel's photo on a card or a detailed card opens it in the Posts tab's photo viewer
- [ ] On a compact card the photo sits above the card's selection layer, so clicking the photo opens the viewer and clicking anywhere else still selects
- [ ] On a tile, a magnifier at the photo's bottom left appears on hover or keyboard focus and opens the viewer; clicking the tile still selects it; a Channel with no photo has no magnifier
- [ ] "Open in Telegram" sits at the bottom right of the photo at every size, shown on hover and on keyboard focus, and opens the Channel's public web view
- [ ] The viewer's arrows step through every Channel photo loaded on the page in grid order, and closing it leaves the grid at the Channel whose photo was viewed last; its accessible title says "Channel photo"
- [ ] The avatars in the Posts tab's post headers never join the Posts tab's photo gallery, and a test fails if they do
- [ ] A tile's name and handle appear in the app's tooltip component instead of the browser's native tooltip
- [ ] The Channels end-to-end spec opens a Channel photo and steps to the next one
- [ ] The frontend CRAP ratchet passes, and every new or changed test is mutation-checked
