# DFP-04: Tag Channels in the Directory and filter by Tag

**What to build:** In the Directory the Account tags its Ticks or the Channel it is reading, sees
each row's Tags, manages its Tags (tick a Tag's Channels, rename, delete), and filters by a Tag
with "In the Tag news", negatable. The server resolves the Tag against the reader's own Tags, so a
link stays short and means "your news" to whoever opens it. See
`.scratch/directory-follow-picks/spec.md`: user stories 11 to 18, 23, 26, 27 and 32 to 35, and
the Tags and Directory filter decisions. Variant F's Sets menu, badges and In-set chip are the
reference (as browser-side pick sets; here they are server-side Tags).

**Blocked by:** DFP-02, DFP-03

**Status:** resolved

- [x] Routes to tag or untag a list of handles (followed or not) with one Tag, list the Account's Tags with Channel counts, rename a Tag Account-wide (onto an existing name merges), and delete a Tag Account-wide; each with a response model, approval-gated, refused in View-as without elevation, and classified by every route guard
- [x] The bulk bar tags or untags the Ticks with an existing or new Tag; the panel adds and removes the open Channel's Tags; rows, cards and the panel show Tags
- [x] A Tags control ticks exactly a Tag's Channels, renames it and deletes it after a confirmation stating how many Channels it is on
- [x] A `tag` Condition in the Directory filter, `tag:"news"` in the text form, resolved by the server in the read for the caller (the target under View-as); NOT negates it
- [x] A Condition naming a Tag the reader does not have keeps its chip, struck through, and matches nothing
- [x] `group:` Tags resolve in the Directory to the Account's followed Channels in that Setting group
- [x] `t` in keyboard mode opens the Tag picker for the highlighted row
- [x] Tag state is server state through TanStack Query; nothing about Tags is kept in browser storage
- [x] Backend tests through the Directory reads: a `tag` Condition and its negation for two Accounts holding a Tag of the same name with different Channels; an unknown Tag matches nothing
- [x] Backend tests through the Tag routes, including a foreign Account's Tags untouched in both flag states
- [x] Playwright: tag the Ticks and see the badge; add "In the Tag" and see the request name the Tag
- [x] The generated client is regenerated and the Playwright mocks follow any changed response shape
