# PTI-05: Compact cards fill the row, and the photo viewer pages the feed

**What to build:** Two frontend changes to browsing the Posts feed. **Compact cards:** a compact
card's text, with a photo or without, grows to the height the tallest card in its grid row sets, in whole lines, never
fewer than three, and "More" appears only when the text still does not fit; "More" expands that card
in place and "Less" returns it; the text never makes its row taller on its own. **Photo viewer:**
opened from the Posts feed, it asks the feed for its next page within three photos of the end and
takes in new photos as they arrive, so browsing continues through the whole feed; past the last
photo it stays there, never wrapping or jumping, and a thumbnail refreshing elsewhere keeps the
place. The Channels grid's and a Summary's viewers are unchanged; the full card is unchanged. See
`.scratch/posts-tab-improvements/spec.md`, user stories 1-19, and "The photo viewer" and "The
compact card" under Implementation Decisions.

**Blocked by:** None (can start immediately).

**Status:** resolved

### Compact cards

- [x] The text sits in a layer inside a box that grows to fill the card, at least three lines tall, so it adds nothing to the row's height
- [x] Lines shown = the box's height over the line height, rounded down, never under three, re-measured whenever the box resizes
- [x] "More" only when the text is taller than those lines; expanded, the text lays out normally and the card grows; "Less" returns it
- [x] Keyword highlighting, Links and right-to-left text behave as in today's three-line text; footers stay aligned at the bottom of the row

### Photo viewer

- [x] The gallery and the position are one piece of state
- [x] A photo is known by its Post's card, falling back to its address
- [x] While open from the Posts feed it watches for new photos; a rescan that no longer finds the current photo is ignored, never answered by moving to the first photo
- [x] Within three photos of the end it asks the feed for its next page; at the last loaded photo with more coming, the caption says more are loading
- [x] Steps clamp at both ends, by key, by button and by swipe; closing still leaves the feed at the Post of the last photo viewed
- [x] Only the Posts feed provides paging; other galleries behave exactly as today

### Tests

- [x] A Playwright spec with a mocked API (layout needs a real browser): a row with a photo card and a long text-only card shows more than three lines and "More"; a short text-only card shows no "More"; "More" grows the card and "Less" returns it; while the long card is expanded, the photo card beside it shows its whole caption and no "More"
- [x] The photo viewer's DOM test: paging asked for near the end; a key or button press at the end stays on the last photo; a refreshed thumbnail keeps the place and new photos join the end; a lost photo moves nothing
- [x] The frontend CRAP ratchet passes (new branching components carry unit tests)
- [x] Each new test watched failing against a mutation first

## Comments

**2026-10-15, after #169 shipped.** Expanding one compact card did not help its neighbours as
intended, for two reasons:

- A card with a photo never grew. The PR's review commit had restricted the fill to text-only
  cards (`fill={!thumb}`), which this ticket allowed. The rule is now every card, and the `fill`
  prop is gone.
- A neighbour that grew kept its "More" even when its whole text then fit. `PostCardClampedBody`
  measured the text against the layer's height from the previous render, and nothing measured it
  again, because the box the ResizeObserver watches had not changed size. It now compares the
  text against the line count it has just chosen.

The Playwright spec now expands the long card and checks the photo card beside it; it fails on
the old measurement.
