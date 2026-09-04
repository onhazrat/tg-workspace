# #83 📝 Re-measure the plan's metrics, and write down what is left

**State:** merged 2026-08-01 · **Branch:** `plan-metrics-refresh` into `main` · **Diff:** +43 / -15 across 1 files · **Opened:** 2026-08-01

---

Documentation only.

## What

§6's metrics table was carrying start-of-programme numbers for half its rows. Re-measured after A1a–A1c, A2, B7b and G1:

| Metric | Start | Now |
|---|---|---|
| `$ref`-typed API responses | 26/129 | **104/121** |
| Generated-client LOC | 10,796 | **4,866** |
| Largest route module | 1,438 | **425** |
| Largest frontend context | 1,103 | **717** |
| Largest backend function | 257 | **173** |
| Hand-written domain mirrors | 24 | **6**, all compiler-enforced |
| Frontend tests | 679 | **744** |
| Backend tests | 767 | **809** |

**Two metrics moved the "wrong" way and both are stated plainly** rather than quietly dropped: frontend LOC is *up* ~2,000, because the programme has so far been adding tests, response models and documented seams while the ~5,950-line deletion it promises sits in **A3/A4**, which have not run. And `AIContext` overtaking `ScraperContext` as the largest context is arithmetic from G1 cutting the latter by 40%, not a regression.

## New §3b — what is left

States the remaining backlog with measured sizes rather than the original estimates. Notably **A3 is 66 exported functions across 47 consumer files** — the largest and riskiest remaining unit, since it touches every write path.

It also carries forward the finding from A2: **A4 must repoint `DatabaseManagement`'s Export/Import DB** at the server endpoints. That import currently writes *nowhere but the browser*, so deleting the IndexedDB mirror without repointing it turns the feature into a silent no-op.

Recommended order: `F1b` (independent) → `A3` → `A4` + `G2` → `F2`. Workstream **E** remains blocked on a decision and blocks nothing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
