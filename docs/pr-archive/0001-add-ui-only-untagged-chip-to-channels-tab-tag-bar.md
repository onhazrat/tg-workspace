# #1 Add UI-only Untagged chip to Channels tab tag bar

**State:** merged 2026-07-04 · **Branch:** `cursor/94df51d3` into `main` · **Diff:** +1135 / -854 across 44 files · **Opened:** 2026-07-04

---

## Summary
- Adds a UI-only **Untagged** pseudo-tag chip on the Channels tab tag bar for selecting channels with no tags
- Pins the chip after all real DB tags so it always appears at the bottom of the tag row
- Reuses shared helpers in `channel-tags.ts` and adds unit tests for untagged filtering

## Test plan
- [ ] Open Channels tab with a mix of tagged and untagged channels
- [ ] Confirm **Untagged** appears after all real tags
- [ ] Click **Untagged** and verify all non-frozen untagged channels are selected
- [ ] Click again to deselect; verify partial selection styling when only some untagged channels are selected
- [ ] Run `bun test src/lib/channels/channel-tags.test.ts`


Made with [Cursor](https://cursor.com)
