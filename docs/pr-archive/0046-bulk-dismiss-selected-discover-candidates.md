# #46 ✨ Bulk dismiss selected Discover candidates

**State:** merged 2026-07-29 · **Branch:** `worktree-discover-bulk-dismiss` into `main` · **Diff:** +125 / -9 across 4 files · **Opened:** 2026-07-29

---

Adds **Dismiss selected** to the Discover bulk bar, mirroring the existing **Follow selected**.

## Behaviour

- Dismisses the whole selection in one call, instead of clearing a report's worth of junk one row at a time.
- **The same button restores while viewing "Ignored"** — there every visible row is already dismissed, so a Dismiss would be a no-op. "Follow selected" is hidden in that view, since following something you've dismissed is contradictory.
- **No confirmation dialog**, deliberately unlike bulk follow: following scrapes channels and creates rows, whereas dismissing sets a flag that this same button undoes. The confirm on follow exists because that action is expensive and outward-facing; this one isn't.
- Acted-on names leave the selection afterwards — dismissed rows also leave the current view, so keeping them selected would leave a "N selected" count referring to rows that are no longer on screen.

## Scope note

Row selection currently excludes **followed** candidates — their checkbox is disabled (`isRowCheckboxDisabled`), which predates this change and is what "Follow selected" is built on. So bulk dismiss covers unfollowed candidates only; followed ones stay dismissable from their own row button.

I kept that scope rather than widening it, because making the checkbox column general-purpose would change what "Follow selected" acts on and what the selection count means. Say the word if you'd rather I broaden selection to all rows — it's a contained change, but it touches the existing follow semantics and their tests.

## Verification

- Frontend: **626 pass, 0 fail** (was 622); `tsc -p tsconfig.build.json` clean; biome back to its 3 pre-existing warnings.
- Backend: **649 passed, 1 skipped** — untouched by this change, run as a sanity check.
- New tests: 4 for `removeFromSelection`.
- Frontend-only; no migration, no API change (reuses the existing `/discover/ignored` endpoints, which already accept a batch).
- E2E not run (needs a live stack).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
