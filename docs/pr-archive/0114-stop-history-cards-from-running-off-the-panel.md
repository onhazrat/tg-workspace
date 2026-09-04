# #114 🐛 Stop History cards from running off the panel

**State:** merged 2026-08-20 · **Branch:** `fix-history-card-overflow` into `main` · **Diff:** +119 / -24 across 4 files · **Opened:** 2026-08-20

---

## The bug

Artifact cards in History extended far past the workspace panel. A grid item defaults to `min-width: auto`, so the track sizes to the item's max-content — and one summary in this database names **1,722 channels**, rendered on a single `truncate` line. `truncate` cannot ellipsize a width that nothing clamped, so the card measured **17,374px** wide.

## The fix

`min-w-0` on the grid item in `HistoryView`. The copies on `ArtifactCard`'s own flex containers make the card safe to drop into any parent, but the grid item is the one that was load-bearing — verified by removing each in turn. The delete-confirm dialog got the same treatment, since it printed the same channel list un-clamped as its description.

## The guard

Types and class strings both looked right while this was broken, so the new assertion measures instead of reading: it seeds a 600-channel summary and compares the workspace scroller's `scrollWidth` to its `clientWidth` in a real browser.

Mutation-tested — **146,600px vs 1,215px** without the fix.

## A seeding bug found on the way

`page.request` does not carry the session token: it lives in `localStorage`, which `storageState` restores for the browser and not for the API context. Every seed PUT in `seed-artifacts.ts` was answering **401** while the helper returned `void`, so the open-artifact specs had been passing on rows left in the dev database by hand. The helper now logs in and asserts each write.

## Verification

- `tsc --noEmit` — 0 errors
- `bun test src` — 840 pass, 0 fail
- `tests/open-artifact.spec.ts` — 5/5 pass
- `tests/summarizer.spec.ts` — 54/56; the two failures (K9, K15, both command-palette confirms) fail identically on a clean tree

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016Mjy4LiaHo6ZPpCcDE4QYf
