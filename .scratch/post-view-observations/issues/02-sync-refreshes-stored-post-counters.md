# REACH-02: Sync refreshes the counters of stored Posts it meets again

**What to build:** When a scraped page contains Posts already stored, sync updates their View
count, reaction chips and observation time, so a stored View count is no longer frozen at whatever
age sync first saw it. The refresh stops at the fixed 7-day refresh horizon and touches nothing
else about the Post. See `.scratch/post-view-observations/spec.md` ("Refresh on overlap") and
ADR-024.

**Blocked by:** REACH-01

**Status:** ready-for-agent

### Backend

- [ ] Each scraped page issues one narrow update for the stored Posts it overlaps, setting View count, reaction chips and observation time only
- [ ] Only Posts younger than the 7-day refresh horizon are refreshed; the horizon is a code constant, not a setting
- [ ] The observation time is stamped even when the View count and chips are unchanged, because Telegram's rounded display holds one value for hours and a skipped stamp would make a Settled Post look young
- [ ] The refresh never runs the full Post upsert and writes nothing else: `retrieval_*`, `updated_at`, `language` and `references_extracted` are unchanged afterwards
- [ ] The refresh does not bump the posts etag, so a sync that found nothing new makes no feed refetch
- [ ] The incremental pass still stops on the overlap page exactly as today; the refresh spends no extra Request
- [ ] Tests at the `_apply_scrape_page` seam (prior art: `tests/services/test_sync_orchestrator.py`): an overlapping page refreshes counters and observation time; a Post older than 7 days is not refreshed; an unchanged count still moves the observation time; provenance, language and reference state are untouched; the etag does not move; the incremental pass still stops
- [ ] `test_sync_meta_commit_cost.py` passes unchanged
- [ ] Every new test is mutation-tested (watched red before trusted)
