# #53 ✨ Discover: sort by subscribers, and fix RTL name display

**State:** merged 2026-07-30 · **Branch:** `discover-subscriber-sort` into `main` · **Diff:** +406 / -20 across 10 files · **Opened:** 2026-07-30

---

Adds a **Subscribers** sort key to the Discover candidate list (IDEA-011 **D15**), and fixes the `name · N subscribers` line, which rendered wrong for Persian channel names.

## Sorting by subscribers

The count comes from the D9 probe rather than from the report, so this is the first sort key whose value can be *unknown* — on a freshly generated report most rows are, until the sweep resolves them. That makes "where does unknown go" the design question, not an edge case.

**Unknown sorts last, never as a number.** Three states collapse into it: never probed, probed inconclusively, and probed off a page with no counter at all (bots and personal accounts have none). Treating them as `0` would rank a handle we have not measured *below* a channel we know to be tiny — asserting a fact we never observed. Treating them as `Infinity` would top the list with the rows carrying the least evidence. Rows unknown on both sides fall through to the existing reference-strength tie-breaks, so the tail stays ordered rather than arbitrary.

## The parser, and a bug in the one that already existed

The count reaches us as display text — `"12.5K"`, `"8 214"`, `"573"` — because `t.me` never gives an exact figure above ~10K. Ranking therefore has to re-derive a magnitude.

Rather than write a second parser, `lib/subscriber-count.ts` is extracted and shared with the channel grid, which had a private copy. That copy multiplied by a million whenever the string contained an "m" **anywhere**, so a count arriving with its label attached (`"204 members"`) became 204 million. The shared parser requires the suffix to end its word. My own test caught this, which is why the test exists.

The grid keeps `?? 0` for unknowns — its asc/desc toggle makes that reasonable, and changing its ordering was not part of this ask.

## The RTL fix

The name and count were one concatenated template string. A Persian channel name is an RTL run inside an LTR line, so the neutral separator and the ASCII count beside it get absorbed and reordered: the count lands to the left of the name, and punctuation at the edge of the name changes sides.

Each run is now its own `dir="auto"` element, which HTML's default stylesheet gives `unicode-bidi: isolate` — the same treatment `PostCard` and `ChannelCard` already use for post text and bios. `lib/bidi-invariants.test.ts` guards it at the source level, because the bug is **invisible on ASCII names** and the tempting simplification back to one template string reintroduces it while looking correct to anyone testing in English.

Also fixed here: a subscriber count now renders when the channel has no display name (the old single combined condition suppressed it), and the candidate panel's display name and quoted sample post get the same `dir="auto"`.

## Scope notes

- **Frontend only** — no backend, no migration, no SDK regeneration. The Discover display sort has always been client-side over the saved report, so a new key re-ranks instantly without regenerating.
- The new key is added to the persisted settings enum, or a saved choice would be rejected on reload.
- No Subscribers *column* was added. The count already renders inline under each name, so the ordering is verifiable without one; a column would mean touching the header, the score-column conditional and the empty-row colspan for no new information.

## Verification

- `bun test src` — **679 pass, 0 fail** (98 files; 3 new test files, 22 new assertions)
- `bunx tsc -p tsconfig.build.json --noEmit` — clean
- `bunx biome check ./src` — clean on every touched file (4 pre-existing warnings elsewhere, untouched)

Not verified: the RTL rendering itself. Reordering happens in the layout engine, and the repo has no DOM test environment, so the invariant test guards the markup shape and the visual result wants one look at a report with a Persian candidate in it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
