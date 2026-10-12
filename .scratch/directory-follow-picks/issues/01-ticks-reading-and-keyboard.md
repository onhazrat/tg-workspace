# DFP-01: Ticks on every row, a quicker read, and keyboard mode

**What to build:** In the Directory, every row can be ticked, followed or not, so a handful of
follows can be the Seeds of a Shared Condition; the bulk bar's Follow and Dismiss act only on the
unfollowed Ticks and say so. "Why it's here" stops running long, the search box says what it
searches, and a keyboard mode lets the Account walk the list with a panel that follows the
highlight. Frontend only. See `.scratch/directory-follow-picks/spec.md`: user stories 1 to 8,
36 to 45 and 54, and the Directory tab decisions. Variant F on
`prototype/directory-follow-picks` is the behaviour reference; **Tick** and **Seed** are in
`CONTEXT.md`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A followed row's tick and the header tick work like any other row's; the header ticks every row on the page
- [ ] "Channels ticked here" in a Shared Condition includes ticked follows
- [ ] The bulk bar's Follow and Dismiss act only on the unfollowed Ticks, labelled "Follow 3 of 5" when some Ticks are follows (matched case-insensitively against every Follow, not only the visible page); with only follows ticked the bar says so and offers neither
- [ ] Ticks stay ticked after a Follow job finishes
- [ ] "Why it's here" shows three citing Posts, then "Show N more" / "Show fewer"; opening another Channel starts collapsed
- [ ] The search placeholder lists the enabled fields in order: "Search names", "Search names and bios", "Search names, bios and posts"
- [ ] A Keyboard switch, kept for the browser session, turns on: j / k, gg / G, ] / [ (landing on the new page's first row once its rows arrive), x / f / d / o pressing the highlighted row's own controls, Enter opening the panel and, while open, the panel following every move and page turn, Enter closing it, Esc dropping the highlight and closing the panel, and the key legend
- [ ] Keys never fire while typing in a field or with a dialog open, as on the other tabs
- [ ] Playwright (`directory.spec.ts`, mocked API): tick a followed row and see "Follow 1 of 2"; keyboard j, x, Enter, j with the panel following
- [ ] Component tests for the keyboard hook, the bulk bar's actionable count and the placeholder, each mutation-tested
