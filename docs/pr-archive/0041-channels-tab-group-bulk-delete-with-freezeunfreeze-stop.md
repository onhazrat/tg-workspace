# #41 💄 Channels tab: group bulk Delete with Freeze/Unfreeze, stop uppercasing tag chips

**State:** merged 2026-07-28 · **Branch:** `worktree-channels-bulk-delete-position` into `main` · **Diff:** +42 / -12 across 4 files · **Opened:** 2026-07-28

---

Two Channels-tab polish fixes.

## 1. Bulk `Delete` moved next to Freeze/Unfreeze

The bulk action bar placed **Delete** at the far right, separated from Freeze/Unfreeze by the "Move to group" and "Tags" control pills. All three act on the same selection in the same way, so they now form one cluster.

```
before: [N Selected] | Freeze  Unfreeze | [Move to group] [Tags] | Delete
after:  [N Selected] | Freeze  Unfreeze  Delete | [Move to group] [Tags]
```

No behaviour change — same `onRequestDelete` handler and `dangerSoft` styling, just relocated in the JSX.

## 2. Tag/group chips no longer forced to ALL CAPS

`tgSelectionChipVariants` baked in `uppercase`, so the chip wall rendered every tag in caps regardless of what the operator typed — `iOS` showed as `IOS`, `McKinsey` as `MCKINSEY`. Casing is *data* on these chips, and `ChannelCard` already renders the same tag names unmodified, so the two views disagreed with each other.

Fixed at the primitive rather than with a `normal-case` override at the call site:

- `TgSelectionChip` (tag chips + setting-group chips) drops `uppercase` and softens `tracking-widest` → `tracking-wide`, since wide letterspacing is an all-caps idiom that hurts mixed-case text.
- `TgFilterChip` **keeps** its uppercase — it labels fixed UI vocabulary ("Original Only", sort names) where caps distort nothing. The divergence is now documented in the file so it doesn't get "consistency-fixed" back.
- Font size deliberately untouched: the tag wall's `COLLAPSED_TAG_WALL_MAX_PX` collapse cap is tuned to a ~26px chip height.

## Verification

- `bun test src` — **626 pass, 0 fail**
- New unit test in `tg-chips.test.tsx` locks the contract (selection chip has no `uppercase`, filter chip does). Mutation-checked: re-adding `uppercase` to the primitive makes it fail, so the guard actually guards.
- Confirmed no ancestor of the chip row sets `text-transform`, so nothing inherits the caps back.
- `bunx tsc -p tsconfig.build.json --noEmit` — the 6 errors it reports are pre-existing on `main` (missing `@tanstack/react-virtual` types, zod v3/v4 mismatch in the auth routes); output is byte-identical to baseline.
- One assertion added to `tests/tg-ui-primitives.spec.ts` (computed `text-transform: none`). **Not executed** — the Playwright suite needs the docker stack and a warm DB, which isn't up in this worktree.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
