# KM-01: The Directory photo viewer

**What to build:** In the Directory, clicking a Channel's avatar opens the
photo viewer the Channels tab uses: from a row, from a phone card, or from the
panel. Clicking anywhere else on the row still opens the panel. The viewer's
arrows step through the photos of the rows on the page, and closing it leaves
the page at the row of the last photo viewed. The panel's photo opens on its
own, without arrows, so it never appears twice beside its own row. In every
photo viewer (Posts, Channels, the Summary strip, the Directory), `p` opens the
Highlight's photo and closes the viewer again, and `h` / `l` step photos as the
arrows do.

Three fixes come with it, each found in the prototype: the viewer starts on the
photo that was clicked, not the first image with the same address (a row and
its panel share one); an avatar that is a button never shrinks in a flex row (a
long name squeezed it to 10 px on a phone); and a key that a dialog already
took (Escape closing the viewer) belongs to the dialog, so it no longer also
drops the Highlight or closes the Directory's panel.

**Blocked by:** None (can start immediately).

**Status:** done

**Context pointers:** spec `../spec.md` (Implementation Decisions: the photo
viewer), ADR-034 (the viewer keeps its own keys), `../prototype.md`. Prototype at
a6aa1eb6; port without the `?variant=` gates:

- [ChannelAvatar.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/ChannelAvatar.tsx): the clicked image handed to the viewer, the button that never shrinks.
- [PhotoViewer.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/post-card/PhotoViewer.tsx): starting from the clicked element, a Directory row as a return target, `h` / `l` and `p` to close.
- [DirectoryTable.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory/DirectoryTable.tsx) and [DirectoryPanel.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory/DirectoryPanel.tsx): the avatars as the button, the phone card's row attribute, the panel's photo as its own gallery.
- [keyboard-moves.ts](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/lib/keyboard-moves.ts): only the "a key a dialog took" check in `keyBelongsElsewhere`; nothing else in it belongs to this ticket.
- Not ported: anything under `directory-photo-prototype/`, the variant switcher, the Vite `.ts.net` host rule.
- Prior-art tests: `PhotoViewer.test.tsx`, `DirectoryTable.test.tsx`, `DirectoryPanel.test.tsx`, `ChannelGridKeyboard.test.tsx`, `tests/directory.spec.ts`.
- The Playwright spec runs over a mocked Directory API, as `tests/directory.spec.ts` does, whose rows have no photo. Give a few mocked rows a public `photoUrl` and route that URL to a small image in the test; an external URL is shown as it is, with no backend photo fetch.

- [ ] A Directory row's avatar, a phone card's avatar and the panel's photo open the photo viewer; a click elsewhere on the row still opens the panel.
- [ ] The viewer's arrows step through the photos of the page's rows in order; rows without a photo are skipped.
- [ ] The panel's photo opens alone, with no arrows and no count, even though its row shows the same photo.
- [ ] The viewer opens on the clicked element, tested with two images of one address.
- [ ] Closing the viewer scrolls the page to the row of the last photo viewed.
- [ ] Every avatar keeps its size at phone width with a long Channel name.
- [ ] `p` opens the Highlight's photo where the Highlight carries one (Posts, Channels, the Directory) and closes an open viewer; `h` / `l` step photos inside it, following the page's reading direction like the arrows.
- [ ] Escape closing the viewer leaves the Directory's Highlight and panel as they were, and the Channels tab's Highlight as it was.
- [ ] Unit tests for each of the above; one Playwright spec opens a row's photo, steps to the next row's, closes, and lands on that row.
- [ ] The build and test typechecks pass, and a render test covers any new branching component.

## Comments

- 2026-10-22: implemented on `claude/km-01-directory-photo-viewer` and merged into the integration branch in a26fae2e (fast-forward).
  Open: the viewer's `h` / `l` / `p` read the typed character, not the key's position; handed to KM-02.
