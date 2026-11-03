# RCH-01: Held new Posts and a skeleton in the loading layout's shape

**What to build:** On the Posts tab, Posts that a refetch brings in above the
last Post already shown wait behind a sticky "↑ N new posts" pill with up to
three Channel avatars, so what the reader is on never moves, in any sort and
even at the top. A click on the pill, or `.` in Keyboard mode, shows them and
scrolls to the first; `.` also puts the Highlight there, and says "No new
posts" when none wait. Posts loading below what has been seen (the next page)
show at once. What counts as seen resets when the feed becomes another list
(filter, sort, window, spotlight, Selected first). The first load's
placeholders take the shape of the layout that will load: a grid of compact
cards in the Compact grid, full cards otherwise. The spec's "RCH-01" section
in `.scratch/posts-reply-chain/spec.md` holds the decisions, including the
hold rule from the prototype.

**Blocked by:** None (can start immediately).

**Status:** done

- [ ] A refetch that brings a Post in above the last shown Post holds it; the
      pill shows the held count and avatars; a page loading below shows at
      once.
- [ ] Clicking the pill shows the held Posts and scrolls to the first; `.`
      does the same and moves the Highlight to it; `.` with none held says
      "No new posts".
- [ ] Changing the filter, sort, window, spotlight or Selected first resets
      what counts as seen, so the new list is never held.
- [ ] The pill takes no room in the feed: its appearing moves nothing.
- [ ] The Highlight's keys move through shown Posts only.
- [ ] The first load shows compact grid placeholders in the Compact grid and
      full card placeholders otherwise.
- [ ] `.` is a Posts list key in the key list and the corner guide; the
      key-list uniqueness check covers it.
- [ ] No variant switch: the behaviour is unconditional on main.
- [ ] Tests: the hold rule's unit test, a mocked Playwright spec for the pill,
      `.` and both skeletons (run serially), each mutation-checked.

## Comments

- 2026-11-03: implemented on `claude/rch-01-implementation-101a85` and merged into `main` in 0b9bfa02 (#265).
  Closed in a sweep of stale Status lines; the Status line was never updated at merge.
