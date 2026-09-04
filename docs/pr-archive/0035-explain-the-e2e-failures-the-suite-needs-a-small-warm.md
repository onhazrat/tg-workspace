# #35 📝 Explain the e2e failures: the suite needs a small warm database

**State:** merged 2026-07-27 · **Branch:** `docs/e2e-warm-db-finding` into `main` · **Diff:** +93 / -19 across 2 files · **Opened:** 2026-07-27

---

`seedTestChannel` appends and never resets — roughly 136 channels per full 3-spec run. Both extremes of that growth curve break the suite:

| `tg_channels` | `tg-ui-primitives.spec.ts` |
|---|---|
| 2,152 (accumulated over ~12 runs) | unrelated tests fail |
| **0 (just truncated)** | **1–2 fail** |
| 6–12 (warm) | **14/14** |

Reproduced A/B with identical code: truncate → 1 failed; immediately re-run without truncating → 14/14.

### Why an empty database fails

The failing assertion is `toBeAttached()` on `[data-slot="tg-icon-button"][data-variant="frosted"]`. Two of the three frosted buttons on a channel card render unconditionally, so failing to find one means **no card rendered at all** — not a styling problem. `TRUNCATE` resets planner statistics and empties the query cache, so the first channel-grid load afterwards overruns the 5s timeout. `seedTestChannel` itself is not the race: it polls the API, reloads, and waits on `[data-channel-name]` with a 15s timeout.

### How to reset properly

Truncate, then warm up with **one spec** (`tg-ui-primitives.spec.ts` leaves 6 channels) and judge the run after that. **Not** the full suite — that adds ~136 in a pass and overshoots the useful range. Target roughly 5–50 channels. Never treat a post-truncate run as a baseline, and never compare two branches measured at different database sizes.

### Scope of the claim — please read

This PR was opened before the E5 pass, and two things in it were overstated. Both are corrected in the third commit:

- It originally said the failures were **resolved** and that nothing was wrong with the application. That holds for most of them, but **`tg-ui-primitives.spec.ts:63` fails at 0, 6, 148 and 154 channels alike**, so this rule does not cover it. That test is tracked separately, with a partial diagnosis and a failed fix attempt recorded so nobody repeats it.
- The reset procedure said "run the suite once as a warm-up", which overshoots into the range that caused the original problem.

It also still corrects the earlier C7 write-up: `main` was measured early against a warm DB and `+C7` later against a much larger one, so DB growth tracked the variable under test. The C7 guard remains correct on its own terms; the causal claim about it did not survive a controlled comparison.

Includes a merge of `main`, so §2m and §2n now sit together — `main` currently has a §2n that refers back to a §2m it does not contain.

Verified: biome clean, `tsc --noEmit` clean, 625 unit tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
