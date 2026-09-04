# #38 💄 Align the Channels tab control rows on one 36px rhythm

**State:** merged 2026-07-28 · **Branch:** `worktree-channels-toolbar-polish` into `main` · **Diff:** +179 / -87 across 5 files · **Opened:** 2026-07-28

---

Polishes the styling and alignment of the controls at the top of the Channels tab, with the bulk **add tag** / **remove tag** fields as the main focus.

## What was wrong

Measured on staging rather than eyeballed — each of the three rows mixed control heights:

| Row | Heights before |
|---|---|
| Toolbar | 42 / 38 / 32px side by side |
| Filter pills | a 29px pill next to a 50px pill, on different baselines |
| Bulk bar | a 50px group pill among 32px buttons |

The tag fields were the worst case. Their submit buttons are absolutely positioned with `inset-y-1` against a shorter input, so **ADD overhung the field's bottom edge and REMOVE spilled past its right edge into the text area**. That left 78px of usable text width, which clipped the `Remove tag...` placeholder.

While fixing the heights I found the cause of much of the drift: `selectTriggerClassName`'s `h-7` never applied, because `SelectTrigger` sets its height through `data-[size=…]` variants that out-specify a plain utility. Every shared select on the tab silently rendered at 36px.

## What changed

- New `channel-grid/control-styles.ts` is the single source for the rhythm: **36px** for a control sitting on a row, **28px** for one nested in a group pill. Applied across the toolbar, filter bar, and bulk bar.
- The two tag fields are now identical twins inside a labelled `TAGS` pill, mirroring the neighbouring `MOVE TO GROUP` pill, with compact `+` / `−` icon buttons that sit fully inside the field. Text area goes **78px → 118px**, so nothing clips.
- Tag and trim inputs take the same card surface as the select beside them instead of fading into the pill's muted fill.
- `selectTriggerClassName` overrides the `data-[size=sm]` variant and call sites pass `size="sm"`, so the declared height actually takes effect.
- Group pills wrap instead of overflowing when a narrow viewport squeezes them.
- Search icons on the two search fields, matching the `@` affordance on the add-channel field.

Behaviour, handlers, placeholders, and the existing `channel-tag-search` test id are unchanged; the tag inputs gain `aria-label`s and test ids.

## Verification

- Every control measures 36px on a shared baseline across all three rows, checked by measuring the live DOM.
- Checked in both dark and light themes, and squeezed to 360px to confirm the pills wrap rather than overflow.
- `tsc --noEmit` clean, biome clean, 625 unit tests pass, all pre-commit hooks pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
