# #29 📐 Fix audit C4 + C5: the tag wall and the letterboxed post media

**State:** merged 2026-07-27 · **Branch:** `fix/audit-c4-c5-layout` into `main` · **Diff:** +381 / -38 across 6 files · **Opened:** 2026-07-27

---

Both were confirmed by measurement in a staging browser pass, and both had a single-cause fix. The pass itself is written up in `docs/staging-ui-ux-audit-verification.md` §2g, which also closes A2, E3, E5, E6 and upgrades E1.

## C5 — the media box was the problem, not the image

`PostCard`'s thumbnail was `w-full max-h-80 … object-contain`. `w-full` forces the `<img>` box to the full card width, `max-h-80` caps its height, and `object-contain` then fits the picture inside that box preserving aspect ratio — so everything left over painted `bg-app-muted`.

Measured on staging across 10 loaded images in a 1413px box:

| Natural size | Drawn width | Dead band | Wasted |
|---|---|---|---|
| 800×427 | 600px | 813px | **58%** |
| 320×180 | 569px | 844px | **60%** |
| 640×800 | 256px | 1157px | **82%** |
| 180×320 | 180px | 1233px | **87%** |

Waste scaled with how portrait the image was.

Now `max-w-full max-h-80 mx-auto`, with `object-contain` dropped as unnecessary: the box takes the picture's own aspect, so there is no leftover to paint. **Drawn size is unchanged** — only the orphaned background goes away.

## C4 — the tag wall is collapsed to ~3 rows

On staging, 85 tag chips formed a **489px wall** and pushed the first channel card to **y=1040 in an 853px viewport** — the Channels tab opened with *no channel visible at all*. It also scaled the wrong way, growing as channels were followed: 357px at 43 active channels, 489px at 59.

`ChannelTagChips` now clips to 92px with a `Show all 85 tags` / `Show fewer` toggle.

Two decisions worth noting:

- **The cap is a height, not a chip count.** Chip width follows the tag name, so "first N chips" does not bound the height — and the height is the defect.
- **Whether the toggle appears is measured**, not guessed from the count (`scrollHeight` vs `clientHeight`, with a 1px tolerance for sub-pixel layout). It is measured *only while collapsed*, because expanding makes the two equal, which would report "no overflow" and hide the control that collapses it again.

**Known limitation:** a selected tag can sit in the hidden overflow, where its selected state is not visible. Sorting active chips into the first rows would fix it but reorders the list under the user, so it is left as a follow-up rather than decided here.

## Regression coverage

`css-invariants.test.ts` gains a **media-sizing sweep**: any `className` combining `w-full`, `object-contain` and a `max-h-*` fails it. Verified by reintroducing the defect — it fails and names `PostCard.tsx` with the exact class list. It deliberately does *not* flag `object-cover` (fills the box, never a dead band), `max-h-80 object-contain` (no forced width), or `w-full object-contain` (no height cap) — none of which orphan space.

`tag-chip-collapse.test.ts` (6) pins the cap against the measurements that motivated it: under 150px, above 50px, under a fifth of the 853px viewport, and under a third of the 489px wall it replaces. Plus the sub-pixel tolerance and the `1 tag` singular.

## Verification

biome clean · `tsc --noEmit` clean · **600 unit tests** (was 591) · **62/62 e2e**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
