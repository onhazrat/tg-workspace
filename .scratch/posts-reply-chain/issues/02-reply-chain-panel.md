# RCH-02: The Reply chain panel, read in one request

**What to build:** On the Posts tab, `[` on a reply, or a click on its
"Reply to #N", opens its whole Reply chain in a side panel, read in one request
from a new chain route: the oldest Post at the top, the starting Post at the
bottom, the Highlight on the parent. Keyboard mode moves inside the panel with
`j`, `k`, `gg`, `G` and counts; every card key acts on the highlighted card;
`]` or Esc closes and returns the feed's Highlight to the starting Post. The
feed scrolls to and dashes the highlighted Post's copy, and dots the starting
Post. `p` steps only through the chain's photos. On a phone the panel is full
screen, nothing is muted and the ring marks the parent. The spec's "RCH-02"
(route) and "RCH-03" (panel) sections in `.scratch/posts-reply-chain/spec.md`
hold every decision; the prototype (variant A3 on the pushed branch
`prototype/posts-reply-chain`, snapshot `994b7a21`) shows them working.

**Blocked by:** ALB-01 (a chain through an Album climbs from its first Post).

**Status:** ready-for-agent

- [ ] `POST /data/posts/chain` returns the Reply chain from the given Post to
      the top in one read, each Post with its real Pick state under the sent
      window and Post selection, and a stop reason: `notReply`,
      `parentNotStored` (with the excerpt), `privateParent`, `depthCap` (100).
- [ ] The route follows a parent in another Channel and climbs from a later
      Album Post through its Album's first Post; it is Account-scoped and in
      the route inventory, and the generated client is regenerated.
- [ ] `[` on a reply, or a click on its "Reply to #N" on the Posts tab, opens
      the panel with the whole chain at once and the Highlight on the parent;
      hovering the link still previews; `[` on a Post that is not a reply says
      so; `[` while open does nothing.
- [ ] Inside the panel `j`, `k`, `gg`, `G` and counts move the Highlight and
      keep it in view; card keys act on the highlighted card; an action key the
      card lacks does nothing; `-`, `+`, `M`, `.` work as in the feed; the
      corner guide lists the panel's keys.
- [ ] `]`, Esc, the close button, a tab switch and a change of filter, sort,
      spotlight or window close the panel and restore the feed's Highlight; a
      Live-minute refetch leaves it open.
- [ ] A reply link inside the chain moves to its parent there; one in the feed
      starts a new chain.
- [ ] The feed copy of the highlighted Post scrolls into view with a dashed
      outline; the starting Post's feed card shows sparse dots when not dashed;
      the feed shows no Highlight ring while the panel is open.
- [ ] Panel cards are the feed's own cards; the Pick box shows only on Posts
      inside the Analysis window; a parent not stored shows Telegram's excerpt.
- [ ] `p` steps only through the chain's photos and never pages the feed.
- [ ] The highlighted card holds still while cards above it load, and after a
      finger or wheel scroll the top card does; this works without rendered
      frames (resize, content change and photo load all re-check).
- [ ] On a phone the panel fills the screen with its close button always in
      view, nothing is muted, and the ring marks the parent; on desk widths it
      overlays the feed's right side. It renders through a portal and is not a
      dialog.
- [ ] Reply links on other tabs keep only the hover preview; the variant A
      feed-jump chain code and the variant switch are gone.
- [ ] Tests: the chain route over HTTP, and the mocked Posts-tab Playwright
      spec at desk and phone size (run serially), plus keyboard-harness cases
      for `[` on a non-reply and `[` while open; each mutation-checked.
