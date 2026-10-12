# PTI-05: Compact cards fill the row, and the photo viewer pages the feed

**What to build:** Two frontend changes to browsing the Posts feed. **Compact cards:** a text-only
compact card's text grows to the height the tallest card in its grid row sets, in whole lines, never
fewer than three, and "More" appears only when the text still does not fit; "More" expands that card
in place and "Less" returns it; the text never makes its row taller on its own. **Photo viewer:**
opened from the Posts feed, it asks the feed for its next page within three photos of the end and
takes in new photos as they arrive, so browsing continues through the whole feed; past the last
photo it stays there, never wrapping or jumping, and a thumbnail refreshing elsewhere keeps the
place. The Channels grid's and a Summary's viewers are unchanged; the full card is unchanged. See
`.scratch/posts-tab-improvements/spec.md`, user stories 1-19, and "The photo viewer" and "The
compact card" under Implementation Decisions.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

### Compact cards

- [ ] The text sits in a layer inside a box that grows to fill the card, at least three lines tall, so it adds nothing to the row's height
- [ ] Lines shown = the box's height over the line height, rounded down, never under three, re-measured whenever the box resizes
- [ ] "More" only when the text is taller than those lines; expanded, the text lays out normally and the card grows; "Less" returns it
- [ ] Keyword highlighting, Links and right-to-left text behave as in today's three-line text; footers stay aligned at the bottom of the row

### Photo viewer

- [ ] The gallery and the position are one piece of state
- [ ] A photo is known by its Post's card, falling back to its address
- [ ] While open from the Posts feed it watches for new photos; a rescan that no longer finds the current photo is ignored, never answered by moving to the first photo
- [ ] Within three photos of the end it asks the feed for its next page; at the last loaded photo with more coming, the caption says more are loading
- [ ] Steps clamp at both ends, by key, by button and by swipe; closing still leaves the feed at the Post of the last photo viewed
- [ ] Only the Posts feed provides paging; other galleries behave exactly as today

### Tests

- [ ] A Playwright spec with a mocked API (layout needs a real browser): a row with a photo card and a long text-only card shows more than three lines and "More"; a short text-only card shows no "More"; "More" grows the card and "Less" returns it
- [ ] The photo viewer's DOM test: paging asked for near the end; a key or button press at the end stays on the last photo; a refreshed thumbnail keeps the place and new photos join the end; a lost photo moves nothing
- [ ] The frontend CRAP ratchet passes (new branching components carry unit tests)
- [ ] Each new test watched failing against a mutation first
