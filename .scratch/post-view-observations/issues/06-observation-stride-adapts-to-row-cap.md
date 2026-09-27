# REACH-06: The Observation stride adapts to the row cap

**What to build:** An hourly worker job doubles or halves the Observation stride from a 6-hour
forecast of the View observation table's size, so disk use has a hard ceiling and the sample grows
back when load falls, without flapping. See `.scratch/post-view-observations/spec.md` ("View
observations") and ADR-024.

**Blocked by:** REACH-05

**Status:** resolved

### Backend

- [x] A pure decision function takes (rows now, inflow over the last 6 hours, rows expiring within 6 hours, cap, current stride) and returns the next stride
- [x] The forecast is rows now plus inflow over 6 hours minus rows expiring within them
- [x] The stride doubles when the forecast exceeds the cap
- [x] The stride halves only when the forecast recomputed at doubled inflow stays under half the cap, and never goes below 1
- [x] The stride holds otherwise
- [x] An hourly job in `app/worker.py` gathers the numbers, writes the answer to the runtime row, and on a doubling deletes exactly the rows no longer selected; the API process never runs it
- [x] Tests of the pure function (prior art: `tests/jobs/test_post_language_walk.py`): doubles above the cap, halves only when doubled inflow stays under half, holds in between, and a quiet hour after a busy one does not flap
- [x] Job test: a doubling deletes exactly the rows the new stride no longer selects, and a halving deletes nothing
- [x] `test_worker_count.py` is updated if it inventories worker jobs, not deleted (it does not: it asserts the API starts no scheduler, which already covers the new job)
- [x] Every new guard and test is mutation-tested (watched red before trusted)
