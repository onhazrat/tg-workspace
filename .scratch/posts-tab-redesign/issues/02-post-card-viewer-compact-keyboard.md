# PTR-02: Post card A, the photo viewer, Compact grid and Keyboard

**What to build:** An Account reading the Posts tab gets the new card: the photo above the text
like Telegram, every action in a visible footer, reactions shown, and a click on the photo opens
it full screen, whole, with zoom, pan and a gallery through the feed. Two switches change how the
feed reads: a Compact grid that packs short cards into columns, and a Keyboard mode that moves
through the feed and fires the actions with single keys. Both last for the browser session. See
`.scratch/posts-tab-redesign/spec.md`, "The card and the photo viewer" and "Compact grid and
keyboard", and user stories 1 to 19 and 25 to 32.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

The prototype on `claude/mattpocock-skills-post-card-4f5186` (`?variant=A-plus`) shows the result;
rebuild it inside today's card structure rather than promoting the prototype's file.

### The card

- [ ] Header: avatar, the Channel's name, the handle linking to Telegram, the time (exact date on
      hover), the post id linking to the Post, and the reply and forward references. A reply
      shows the start of the replied-to Post and links to it; an unfollowed forward source offers
      to add it, as today
- [ ] The photo sits between the header and the text at today's size rule: never wider than the
      card, at most 20rem tall, shape kept, framed and centred. Never cropped or stretched
- [ ] Footer: views (exact number on hover), up to four reactions most frequent first and "+N"
      (a paid chip as a star, a custom emoji as a neutral glyph), and the actions translate, find
      related, copy link and open in Telegram, always visible. Translate and the show-this-Channel
      action carry a label on wide screens
- [ ] Copy link confirms with a toast
- [ ] Everything today's card does is kept: media badges, the long-post collapse, search
      highlighting, Links, translation with its busy state, find related only with embeddings on.
      The existing card tests still pass or move with the parts they test
- [ ] The Channel's name and a followed forward source are where PTR-04 attaches Channel
      spotlight; until then the name is plain text and the handle is the link

### The photo viewer

- [ ] A click on the photo opens a dialog sized in viewport units, with the whole photo in view
      at 1x (`object-contain`), whatever its shape
- [ ] Scroll or trackpad pinch zooms about the pointer, 1x to 8x; the wheel listener is
      non-passive so a pinch zooms the photo and not the page. A double-click toggles 2.5x at the
      point clicked
- [ ] Drag pans a zoomed photo, clamped to the photo's drawn size, so a narrow photo stays centred
      sideways and no photo can be dragged off screen
- [ ] Left and right arrow keys and two side buttons step through every photo the feed has loaded,
      in feed order; each starts at 1x again. A pill names the Channel and says "3 / 41" and the
      zoom controls
- [ ] A click at 1x (after a delay a double-click cancels), Escape and the close button close it.
      Closing scrolls the feed to the Post of the last photo viewed, and the dialog's return focus
      does not scroll it straight back
- [ ] The photo is the cached thumbnail; there is no larger image

### Compact grid and Keyboard

- [ ] Two switches in the filter bar's pill row, styled as its pills. Both last for the browser
      session, namespaced per Account, through a session counterpart added to the scoped storage
      module. The browser storage guard, which counts session storage too, is not changed
- [ ] Compact grid: an auto-fill grid of columns at least 22rem wide, in feed order left to right.
      A compact card has a one-line header (small avatar, name, time), the photo capped at 10rem
      and centred, three lines of text with More and Less, and a footer pinned to the bottom with
      the post id, views, reactions, media badges and icon actions, so footers line up in a row
- [ ] Keyboard: j and k select the next and previous card (a visible ring, scrolled into view,
      starting from the first card on screen); p opens the photo, t translates, r finds related,
      c copies the link, o opens in Telegram. f is added by PTR-04 and x by PTR-05. A card in the
      corner lists the keys while the mode is on, and the action tooltips show their letter
- [ ] Keys do nothing with a modifier held, inside a text field, or while a dialog is open; the
      arrow keys belong to the photo viewer while it is open

### Tests

- [ ] Component tests: the card's footer actions and reactions; the photo viewer's zoom bounds,
      clamped pan on a narrow and a wide photo, gallery step resetting zoom, and each way of
      closing; the compact card's clamp and More; the keyboard handler's ignore rules
- [ ] A pure test for the scoped session storage counterpart: keys namespaced under the Account,
      a second Account reading nothing of the first's, errors swallowed
- [ ] The existing Playwright specs that drive the Posts feed still pass, updated for the new card
      where they select its parts
