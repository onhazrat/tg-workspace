# REACH-05: View observations are recorded and pruned

**What to build:** A sample of View counts is kept, with each Post's age at the sighting, as View
observations for 14 days after publication, so the Settling curve can later be fitted from them.
The sample is chosen by an Observation stride held in a runtime settings row, and a row cap from the
environment bounds the table. See `.scratch/post-view-observations/spec.md` ("View observations")
and ADR-024.

**Blocked by:** REACH-02

**Status:** ready-for-agent

### Backend

- [ ] A new table `tg_view_observations`: the Post (foreign key, cascading on delete), its View count, its publication time and the observation time
- [ ] A row is written at first capture and at every REACH-02 refresh, only for Posts where `(post_id - 1) % stride == 0`, `post_id` being Telegram's per-Channel id
- [ ] The stride lives in a runtime row in `tg_app_settings`, classified in the settings registry as deployment state as `sync_runtime` is, and starts at 1
- [ ] Rows are deleted once their Post is 14 days past publication, all of one Post's rows together; this is its own retention rule, not a window on an existing one
- [ ] The row cap is an environment variable in `config.py`, default 1,000,000, documented in `.env.example` with its measured disk cost (measure a local table of that size and write the number down)
- [ ] The table is placed in `tenancy.SCOPES` as a corpus fact (or excused in `OUT_OF_SCOPE` with a reason), added to the test cleanup inventory, and listed in `EXPORT_OMISSIONS` with a reason
- [ ] Tests at `_apply_scrape_page`: an observation row is written only for Posts the stride selects, at stride 1 and at stride 4; the prune removes a 15-day-old Post's rows and keeps a 13-day-old one's
- [ ] Existing guards updated, not deleted: the settings-table split guard (the runtime row), the tenancy seam classification, `test_tg_cleanup_inventory.py`, the retention inventories in `test_retention_split_four_ways.py`, the export coverage guard, and `test_env_example_matches_defaults.py`
- [ ] Every new guard and test is mutation-tested (watched red before trusted)
