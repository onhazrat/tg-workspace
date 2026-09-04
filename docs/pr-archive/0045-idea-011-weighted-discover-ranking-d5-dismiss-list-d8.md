# #45 ✨ IDEA-011: weighted Discover ranking (D5) + dismiss list (D8)

**State:** merged 2026-07-29 · **Branch:** `worktree-discover-ranking` into `main` · **Diff:** +1202 / -45 across 25 files · **Opened:** 2026-07-29

---

Two more IDEA-011 workstreams, plus the Min hits control change.

## D5 — weighted ranking

`total` summed forwards, mentions and links at equal weight, so a mention-heavy channel outranked a genuinely republished source with the same count.

- New **"Weighted"** sort alongside `total`. `total` is deliberately left alone — redefining it would silently reorder every existing view and change what "Min hits" means.
- **Weights are user-editable** (defaults 3/2/1 for forward/link/mention). The right ratio is corpus-specific, so it's a setting rather than a constant baked into the ranking.
- **Scoring and re-sorting are client-side** over the saved report, so changing a weight re-ranks instantly — no regeneration, no round-trip.
- The weights editor appears only while that sort is active, and a **Score** column appears with it. A weighted rank driven by a number the table never shows reads as arbitrary.

## Min hits → free integer

Replaces the fixed 1+/2+/5+ buttons with a number input (floor 1). The useful threshold depends on report size, and on a wide scope the single-reference tail runs well past 5.

## D8 — dismiss list

Every rerun re-surfaced everything already rejected. Since good candidates get followed and drop out of the unfollowed view, the report filled with rejects and got *less* useful the more it was used.

- `tg_discover_ignored` + migration, keyed by the **normalized handle**, so a dismissal survives the candidate reappearing with different casing.
- **`isIgnored` is resolved live per read**, exactly like `isFollowed` — dismissing updates every saved report at once, not just the one on screen. A report records what was *referenced*; what the operator has since decided about it is current state, not history.
- Dismissed rows are hidden from All / Unfollowed / Followed and surface under a new **Ignored** filter. Hiding them everywhere is the point (a labelled row still costs attention), while the Ignored view keeps every dismissal reviewable and undoable — not a silent blocklist.
- The stored report **keeps** the dismissed candidate row, or there'd be nothing left to un-dismiss from.
- Dismiss/Restore is offered for followed candidates too: a channel can be worth following and still be noise in the weekly report.
- Ignoring is idempotent; un-ignoring an unknown handle is a no-op, since the UI treats this as a toggle.

## Verification

- Backend: **649 passed, 1 skipped** (was 640); `mypy` + `ty` + `ruff` clean.
- Frontend: **622 pass, 0 fail** (was 615); `tsc -p tsconfig.build.json` clean; biome clean.
- New tests: `test_discover_ignored.py` (9), `discover-weighted-sort.test.ts` (7), `discover-ignored-filter.test.ts` (7).
- Migration `v4w5x6y7z8a9` chains onto `u3v4w5x6y7z8`; single linear head, verified from a scratch database.
- E2E not run (needs a live stack).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
