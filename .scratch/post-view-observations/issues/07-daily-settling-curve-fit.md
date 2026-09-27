# REACH-07: A daily Settling curve fit replaces the seed curve in estimates

**What to build:** A worker job fits one global Settling curve from View observations every day and
stores it; an estimated Reach uses the newest fit instead of the seed curve. See
`.scratch/post-view-observations/spec.md` ("Settling curve") and ADR-024.

**Blocked by:** REACH-03, REACH-05

**Status:** ready-for-agent

### Backend

- [ ] A pure fit function takes (pairs, settling age, seed) and returns knots or nothing
- [ ] About 16 knots log-spaced from 30 minutes to 7 days; the curve is piecewise-linear log share over log age
- [ ] Each pair of consecutive observations of one Post contributes one linear equation between its two ages, however many knots it spans; only consecutive pairs are used, and a Post with one observation contributes nothing
- [ ] The system is solved by least squares with numpy, made non-decreasing by pool-adjacent-violators, and anchored so the share at the settling age is 1
- [ ] A span between knots with fewer than 30 pairs takes its shape from the seed; a fit where every span falls back returns nothing and is not stored
- [ ] No weighting by Channel: every observed Post counts once
- [ ] A new fits table, one row per fit: the knots, the settling age it was anchored at, the Observation stride at the time, and the counts of pairs, Posts and Channels it used; rows are kept forever and excused from retention with that reason
- [ ] A fourth deployment setting, curve refit interval (hours, default 24), classified in the settings registry
- [ ] The job runs in the worker at that interval and immediately when the settling age changes; it gathers pairs through `unscoped_select(reason=...)`, since the curve is a corpus fact
- [ ] Reach uses the newest stored fit, else the seed curve
- [ ] Fit tests (prior art: `tests/jobs/test_post_language_walk.py`): recovers a known curve from synthetic pairs; output is monotone; anchored at the settling age; falls back per span below 30 pairs; returns nothing when every span falls back
- [ ] Job tests: a settling-age change triggers a refit; an empty observation table leaves the previous fit current
- [ ] Existing guards updated, not deleted: the settings-table split guard (the new key), the tenancy seam classification, `test_tg_cleanup_inventory.py`, the retention inventories (the fits table excused), and the export coverage guard (the fits table an omission with a reason)
- [ ] Every new guard and test is mutation-tested (watched red before trusted)
