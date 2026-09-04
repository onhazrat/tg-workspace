# #26 🐛 Fix Channels infinite scroll broken by grid virtualization

**State:** merged 2026-07-26 · **Branch:** `fix/channels-infinite-scroll` into `main` · **Diff:** +100 / -87 across 5 files · **Opened:** 2026-07-26

---

**Hotfix.** The Channels grid on staging loads the first 20 of ~1,150 channels and then stops — you cannot browse past the first page. Introduced by me in #25 (Batch 3, B2) and found by the Batch 0 browser pass.

## Cause

Load-more was driven by an `IntersectionObserver` on a sentinel below the grid. Once the grid became virtualized it carries an explicit height from `getTotalSize()` that changes as rows are measured, and against that the observer stopped firing — it did not deliver even its mandatory initial callback.

Verified directly on staging: the sentinel was present, 40px tall, `display: block`, geometrically inside the viewport (top 877, container bottom 969) and a genuine descendant of the scroll container — yet a fresh observer with the same `root` and `rootMargin` never fired. Reproduced across five scroll-to-bottom attempts on a clean load: `[20, 20, 20, 20, 20]`.

## Fix

Drive load-more from the virtualizer, which already knows what it is showing, rather than inferring it from geometry. `useScrollLoadMore` had no other consumer and is removed.

The trigger is the last **visible** row (`virtualizer.range`), not the last *rendered* one. Rendered rows include the overscan, which by design already reaches past the end of a short list — my first attempt keyed on that and fetched the next page the instant the previous one arrived, which would have walked the entire account in one go. The new test caught that before it went anywhere.

## Why the suite missed this, and what now covers it

`channel grid loads more cards on first visit when scrolling` seeds **25** channels and asserts a **single** load, 20 → 25. Twenty-five cards fit entirely inside the overscan, so it never exercised windowing, and one load never exercised the second. **It passed for the wrong reason** — and I treated 61 green tests as proof the change was sound.

The new test seeds **70**, asserts **three consecutive loads** (20 → 40 → 60 → 70), and asserts the DOM holds materially fewer than 70 cards so windowing is genuinely active. It fails against the broken version.

## Verification

- `biome` clean · `tsc --noEmit` clean
- **571** unit tests, 3 consecutive clean full runs
- **62/62 e2e** against a freshly rebuilt backend (61 + the new regression test)

> Note: one non-reproducible `mirror-hydration` unit failure was seen once and did not recur across 5 targeted and 3 full runs. Flagging rather than claiming it fixed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
