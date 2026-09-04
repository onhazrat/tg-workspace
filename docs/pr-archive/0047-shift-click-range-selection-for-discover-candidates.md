# #47 ✨ Shift-click range selection for Discover candidates

**State:** merged 2026-07-29 · **Branch:** `worktree-discover-shift-select` into `main` · **Diff:** +140 / -11 across 3 files · **Opened:** 2026-07-29

---

Gmail-style range select on the Discover candidate checkboxes: click one, shift-click another, and every row between them takes the same state.

Applies to the Discover candidate table — the only surface in the app with per-row selection checkboxes (ChannelCard selects by card click; the other checkboxes are filter/settings toggles).

## Behaviour

- **The state applied across the range is the one the clicked row ends up in.** Shift-clicking a *selected* row clears the range rather than re-selecting it, matching mail clients.
- **Followed rows are skipped, not toggled.** Their checkbox is disabled, so a sweep must not do what clicking them directly cannot.
- **The anchor is the last row toggled without shift, and stays put.** Repeated shift-clicks therefore grow and shrink one range instead of chaining new ones from wherever you last landed.
- **The anchor is stored by name, not index.** Sorting or filtering between two clicks would otherwise silently move it to a different channel. If the anchor row is no longer on screen, the click falls back to a plain toggle rather than selecting an arbitrary span.
- Keyboard activation (space on a focused checkbox) reports `shiftKey: false`, so it stays a plain toggle.

`onChange` carries no modifier keys, so shift is captured in `onClick` — which React dispatches before `onChange` for checkboxes — and read a moment later.

## Verification

- Frontend: **635 pass, 0 fail** (was 626); `tsc -p tsconfig.build.json` clean; biome back to its 3 pre-existing warnings.
- New tests: 9 for `selectRange`, covering both directions, followed-row skipping, range deselect, missing anchor, out-of-bounds indices and input immutability.
- Frontend-only; no API, migration or backend change.

**Not verified here:** the repo has no DOM/interaction test setup (component tests use `renderToStaticMarkup` only), so the click-before-change ordering is unverified in a real browser — the range *logic* is unit-tested, the event plumbing is not. Worth a quick manual check on staging: select a row, shift-click one a few rows down, confirm the span fills in and that shift-clicking a selected row clears it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
