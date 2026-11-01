# Posts reply chain: the Reply chain panel, held new Posts, a skeleton in the loading layout's shape

Status: ready-for-agent

Ticket prefix: `RCH`.

Settled in a grilling session on 2026-11-02 against prototype variant **A3**
("Panel list"), which won over variants A, A2, B and C. The prototype is the
pushed branch `prototype/posts-reply-chain`
(one-commit snapshot `994b7a21`); run steps and every behaviour are
in `.scratch/posts-reply-chain/brief.md`. Its code was written under prototype
rules: rewrite it, do not promote it. Terms: **Reply**, **Reply chain**,
**Album**, **Highlight** (amended), **Keyboard mode**, **Pick** in
`GLOSSARY.md`. The Album split (`.scratch/album-posts/`, ADR-046) lands before
the chain route.

## Problem Statement

On the Posts tab a reply shows "Reply to #N" and previews its parent on hover,
one level only. To follow a conversation further I hover again inside a hover
card, and the keyboard cannot do it at all. Whole Channels post in long
self-reply runs (one on staging is 12 Posts deep), and there is no way to read
such a run in order, move through it, or act on one of its Posts.

Two more problems on the same tab. When a sync or the Live minute brings new
Posts in, they appear above what I am reading and push it down, or sideways in
the Compact grid, so I lose my place. And while the feed first loads, its
placeholders are always full-width cards, even when the Compact grid is about
to draw a grid.

## Solution

`[` on a reply, or a click on its "Reply to #N", opens its whole Reply chain in
a side panel: the oldest Post at the top, the Post I started from at the
bottom. Keyboard mode moves inside the panel with its usual keys, every card
key acts on the Post the Highlight is on, and `]` closes the panel and puts me
back where I was. Where the feed also shows the highlighted Post, the feed
scrolls to it and outlines it. On a phone the panel fills the screen and
behaves as a reading view.

New Posts that arrive above what I have already seen wait behind an
"↑ N new posts" pill until I click it or press `.`. The first load's
placeholders take the shape of the layout that is about to appear.

## User Stories

1. As a reader, I want `[` on a reply to open its whole Reply chain, so that I
   can read a conversation from its first Post to the one I was on.
2. As a reader, I want the oldest Post at the top and the Post I started from
   at the bottom, so that the chain reads in the order it was written.
3. As a reader, I want the Highlight to start on the Post my reply answers, so
   that the first thing I see is what I asked for.
4. As a Keyboard mode reader, I want `j` and `k` to move the Highlight through
   the chain, so that I can read it Post by Post.
5. As a Keyboard mode reader, I want `gg` and `G` and counts like `3k` to work
   in the chain, so that I can jump to its top or back to where I started.
6. As a Keyboard mode reader, I want every card key (`p`, `y`, `o`, `x`, `l`,
   `r`, `c`, `m`) to act on the Post the Highlight is on in the panel, so that
   I can open, copy, translate or Pick any Post of the chain.
7. As a Keyboard mode reader, I want a key the panel's card has no control for
   to do nothing, so that it never acts on a Post in the feed behind the panel.
8. As a Keyboard mode reader, I want `-`, `+`, `M` and `.` to work as in the
   feed while the panel is open, so that the feed's own keys are not lost.
9. As a Keyboard mode reader, I want `]` or Esc to close the panel and return
   the Highlight to the Post I started from, so that I continue where I was.
10. As a reader, I want `[` on a Post that is not a reply to say so, so that I
    know why nothing opened.
11. As a reader, I want the corner key guide to list the panel's keys while it
    is open, and the feed's otherwise, so that the guide matches what works.
12. As a reader, I want a click on "Reply to #N" to open the Reply chain, while
    hovering it still previews the parent, so that the mouse has both a peek
    and the full chain.
13. As a reader, I want a reply link inside the open chain to move to its
    parent within the chain, so that clicking never restarts what I am reading.
14. As a reader, I want a reply link in the feed to start a new chain while one
    is open, so that I can switch conversations without closing first.
15. As a reader, I want the feed to stay usable with the mouse while the panel
    is open, so that the panel never locks me out of the tab.
16. As a reader, I want the feed to scroll to the highlighted Post and outline
    it dashed when the feed also shows it, so that I see where it sits.
17. As a reader, I want the Post I started from outlined with sparse dots in
    the feed whenever it is not the dashed one, so that I can find my way back.
18. As a reader, I want `p` in the panel to step only through the chain's
    photos, so that the photo viewer never wanders into the feed or loads its
    next page.
19. As a reader, I want the highlighted Post to stay in view as I move and to
    hold still while the chain loads above it, so that the panel never jumps
    away from what I am reading.
20. As a reader, I want the whole chain to load in one go, so that a long chain
    appears at once rather than level by level.
21. As a reader, I want a parent that is not stored to show Telegram's excerpt
    and end the chain, so that I still see what was answered.
22. As a reader, I want the Pick box in the panel to show a Post's real Pick
    state, and only on Posts inside the Analysis window, so that ticking a Post
    there means what it means in the feed.
23. As a reader, I want a chain through an Album to continue from the Album's
    first Post, so that a reply to any photo leads on up.
24. As a phone reader, I want a tap on "Reply to #N" to open the chain full
    screen with a close button always in reach, so that it works without a
    keyboard.
25. As a phone reader, I want no Post in the chain muted and a ring on the Post
    my reply answers, so that I can read the whole chain in full colour and
    still see where I came in.
26. As a phone reader, I want a finger scroll to keep my place while photos
    load above, so that loading never moves what I am reading.
27. As a reader, I want the panel to close when I switch tabs or change the
    filter, sort, spotlight or window, and to stay open through a Live-minute
    refetch, so that it never shows a chain from a view I have left.
28. As a desk reader, I want the panel to overlay the feed's right side, so
    that the feed keeps its layout.
29. As a reader, I want new Posts that arrive above what I have seen to wait
    behind an "↑ N new posts" pill with their Channels' avatars, so that what I
    am reading never moves.
30. As a reader, I want a click on the pill to show the new Posts and scroll to
    the first, so that I choose when the feed changes.
31. As a Keyboard mode reader, I want `.` to show the new Posts and put the
    Highlight on the first, so that I need no mouse for it.
32. As a reader, I want Posts held in every sort and even at the top of the
    feed, so that the Compact grid never shifts sideways under me.
33. As a reader, I want Posts that load below what I have seen (the next page)
    to show at once, so that paging is never held back.
34. As a reader, I want what counts as seen to reset when I change the filter,
    sort, window, spotlight or Selected first, so that a new list is never
    treated as news.
35. As a reader, I want the first load's placeholders to be a grid of compact
    cards in the Compact grid and full cards otherwise, so that the page does
    not change shape when the Posts arrive.

## Implementation Decisions

### RCH-01: held new Posts and the skeleton

- **Hold rule** (pure, from the prototype): given the feed's Posts in order and
  the set of keys already shown, a Post not yet shown that sits before the last
  shown Post is held; every other Post shows. With nothing shown yet, nothing
  is held.

  ```ts
  // from the prototype
  holdNewPosts(posts, seen, keyOf) -> { shown, held }
  // last = index of the last post whose key is in `seen`
  // held = posts before `last` whose key is not in `seen`
  ```

- The feed hook exposes a key naming the list (the feed read's query key); a
  change of it resets what counts as seen. Shown Posts join the seen set after
  each render; showing the held Posts adds them too.
- The pill sticks to the top of the feed in a row that takes no room in the
  feed, so its appearing moves nothing. It shows up to three Channel avatars
  and "N new post(s)", and names `.` in its tooltip in Keyboard mode.
- `.` is a Posts list key (alongside `-`, `+`, `M`) that shows the held Posts
  and moves the Highlight to the first; with none held it says "No new posts".
  The key-list uniqueness check covers it.
- The skeleton follows the Compact grid setting: a grid of compact placeholder
  cards (one-line header, a photo on every third, three text lines, footer) or
  full placeholder cards (avatar, two header lines, tick box, a photo on every
  other, four text lines, footer).
- The Highlight's keys use the shown Posts, never the held ones.

### RCH-02: the chain route

- `POST /data/posts/chain` takes a Channel and a post id, plus the Analysis
  window and Post selection (as the scoped reads do). It returns the Posts of
  the Reply chain from the given Post up to the top, each as the lookup's
  selectable Post with its real Pick state, and a stop reason: `notReply`,
  `parentNotStored` (with the reply's excerpt), `privateParent`, or `depthCap`.
- One recursive query walks up through the unique (Channel, post id) index; the
  parent's Channel is the reply's `reply_to` channel, or the reply's own when
  empty. A reply link with no Channel is a private parent. At most 100 levels.
- A later Album Post climbs from its Album's first Post (ADR-046).
- Account scoping and the route inventory follow the other data routes; the
  generated client is regenerated.

### RCH-03: the panel

- **State**: the Post the chain started from and the chain's Posts as the
  route returned them. Opening from the feed or a reply link reads the route
  once; a reply link inside the open chain only moves the Highlight to its
  parent there.
- **Keyboard**: while the panel is open, Keyboard mode's list is the panel's
  (its own list in the key list, "chain", with its own corner rows). Its items
  are the chain's Posts top to bottom; the Highlight starts on the parent.
  Moves reveal the item inside the panel instantly. `]` and Esc close; `[`
  while open is taken and does nothing. Closing restores the feed's Highlight.
  Card keys press the highlighted panel card's own controls; an action key with
  no control there is taken and does nothing.
- **Cards** are the feed's own post cards, so they carry every action. A Post
  outside the Analysis window shows no Pick box. A parent that is not stored
  shows Telegram's excerpt.
- **Muting**: the cards the Highlight is not on are muted only in Keyboard
  mode. Without it, nothing is muted and the ring stays on the parent.
- **Feed marks**: the feed copy of the highlighted Post scrolls into view and
  takes a dashed outline; the starting Post's feed card takes sparse round dots
  (round dots 12 px apart, drawn inside the card) when it is not the dashed
  one. The Highlight's own ring is never shown in the feed while the panel is
  open.
- **Photos**: the panel is its own photo gallery and turns the feed's paging
  off inside it.
- **Holding still**: the panel holds one card at its place on screen: the
  highlighted card when the chain opens, then whatever a move or a reply link
  brought into view, or the top card after a finger or wheel scroll. It
  re-checks on resize, on content change and on photo load, and only real
  input counts as the reader's scroll. Writes happen only on a real shift.
- **Layout**: rendered through a portal to the page; a full-screen sheet with a
  sticky header and a thumb-sized close on a phone, a right-hand overlay on
  desk widths. Not a dialog: Keyboard mode ignores keys while a dialog is open.
- **Closing**: `]`, Esc, the close button, a tab switch, and a change of filter,
  sort, spotlight or window. A Live-minute refetch leaves it open. Nothing in
  the URL.
- **Removed**: the current feed-jump chain code (variant A) and the variant
  switch. The hover preview of "Reply to #N" stays on every tab; only the
  Posts tab's click opens the chain.

## Testing Decisions

- A good test drives the system from its edge and checks what the reader sees
  or the route returns; it never asserts on private helpers, hooks' internals
  or query shapes. Every new guard and test is mutation-checked.
- **Seam 1, the chain route over HTTP.** Prior art: the posts lookup API
  tests. Seed Posts and an Account; assert the Posts from the start to the
  top, the Pick state under a window and a selection, each stop reason
  (`notReply`, `parentNotStored` with the excerpt, `privateParent`,
  `depthCap`), a cross-Channel parent, and the climb through an Album's first
  Post.
- **Seam 2, the Posts tab in the real app with its reads mocked (primary
  frontend seam).** Prior art: the mocked Playwright specs for reply previews,
  the Compact grid, and the feed-news spec from the prototype. One spec covers:
  the pill and `.`; the skeleton in both layouts; `[` opening the whole chain
  with the Highlight on the parent; `j`, `k`, `gg`, `G` and a count inside it;
  a card key acting on the highlighted card and an absent one doing nothing;
  `]` and Esc restoring the feed's Highlight; the dashed and dotted outlines;
  `p` stepping only the chain's photos; the corner guide's rows; at phone size
  the full-screen panel with its close button in view, nothing muted, and a
  reply-link tap moving within the chain; the panel closing on a filter change.
  Run serially, as the e2e suite requires.
- **Seam 3, small units.** The hold rule's existing unit test, and a few
  keyboard-harness cases (prior art: the Posts feed keyboard tests) for key
  routing that Playwright reaches slowly: `[` on a non-reply, `[` while open,
  the key-list uniqueness check with `.`.

## Out of Scope

- Replies downward (the replies a Post has).
- Opening the Reply chain from other tabs (Citations, Chat sources keep the
  hover preview).
- Narrowing the feed under the panel on desk widths (it overlays).
- The Album split itself (`.scratch/album-posts/`).
- Keeping an open chain across reloads or in the URL.

## Further Notes

- Per-level lookups cost about 0.7 s each on staging; an 11-level chain took
  8.5 s in the prototype, which is why the route reads the chain at once.
- Replies are about one card in ten in the default feed, and their parents are
  rarely in it because of the per-Channel cap; the panel does almost all the
  work, the feed marks less often.
- A page in a hidden browser renders no frames, so resize notifications never
  arrive there; the holding-still logic must not depend on them alone. The
  prototype hit this while being checked in a hidden pane.
