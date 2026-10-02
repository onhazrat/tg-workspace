# REACH-09: The seed curve comes from real fits

**What to build:** The seed Settling curve in code, which started as a one-off cross-Post
measurement confounded by Channel growth, is replaced by a curve fitted from real View
observations, so a fresh deployment's estimates no longer rest on that measurement. See
`.scratch/post-view-observations/spec.md` ("Settling curve", "Further Notes") and ADR-024.

**Blocked by:** REACH-07, and at least a few days of daily fits stored on staging

**Status:** resolved

### Backend

- [x] Read staging's fits table read-only and pick a recent fit whose spans did not fall back to the seed
- [x] Replace the seed constants with that fit's knots, rescaled so the share at the default settling age is 1
- [x] Record beside the constants the source fit's date and its pair, Post and Channel counts
- [x] The Reach and fit tests that depend on the seed's values are updated, not deleted, and still pass
