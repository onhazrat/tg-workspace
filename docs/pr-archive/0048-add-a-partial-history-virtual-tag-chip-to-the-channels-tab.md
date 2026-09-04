# #48 ✨ Add a "Partial history" virtual tag chip to the Channels tab

**State:** merged 2026-07-29 · **Branch:** `partial-history-virtual-tag` into `main` · **Diff:** +290 / -63 across 6 files · **Opened:** 2026-07-29

---

## What

Adds a **Partial history** chip to the Channels tab tag wall, next to **Untagged**. Clicking it selects (or deselects) every channel whose stored history does not reach the scrape retention cutoff — the same channels that already show the amber *Partial history* badge on their card.

Previously that selection was only reachable through the command palette.

## How

Instead of copy-pasting the bespoke `Untagged` wiring, both are now one concept — a `ChannelPseudoTag` descriptor in `lib/channels/channel-tags.ts`:

```ts
type ChannelPseudoTag = {
  id: string
  label: string
  testId: string
  icon: LucideIcon
  tooltip: string
  matches: (channel: Channel) => boolean
}
```

One entry in `CHANNEL_PSEUDO_TAGS` now gives a pseudo-tag its chip, its tag-search matching, and its command-palette selection. This replaced two bespoke props (`showUntaggedTagChip`, `untaggedChannelNames`) plus a duplicated `useMemo` in `ChannelGrid` with a single `pseudoTagChips` list.

The chip reuses the card badge's `Clock` icon and wording so the two views name the same thing, and carries a tooltip ("Channels whose history does not reach the retention window") since the label alone is ambiguous.

## Behaviour notes

- Pseudo-tag chips now **hide when they match no channel**, like real tag chips do, rather than sitting at `(0/0)`. This applies to `Untagged` too.
- `historyCompleteToCutoff === undefined` means *not yet determined* and is deliberately **not** treated as partial — same predicate the existing bulk "Fix Partial History" flow uses (`isPartialHistoryChannel`, extracted from `filterPartialHistoryChannels`).
- Pseudo-tag ids stay `__ui_`-prefixed and are never persisted; toasts now name them by label instead of leaking the raw id.

## Verification

- `tsc --noEmit` clean
- biome clean (3 pre-existing warnings untouched)
- **634 unit tests pass / 0 fail** — 9 new, covering the predicate boundary, chip building, tag-search filtering, hide-when-empty, and a render smoke test of the chip row
- All pre-commit hooks passed; commit is signed

E2e was not run (needs a warm local DB per the project's known setup); the change is frontend-only and the affected chip has a stable `data-testid="channel-tag-partial-history"`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
