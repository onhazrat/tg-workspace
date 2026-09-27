# REACH-04: Directory entries show Reach under the new rule

**What to build:** A Directory entry's `median_views`, computed from hours-old preview samples,
becomes Reach under the same rule as a followed Channel, so a busy Channel is no longer ranked
below a quiet one for posting often. An entry whose Channel any Account follows shows the
Post-based Reach, so one Channel never shows two values. Discover sorts by Reach. See
`.scratch/post-view-observations/spec.md` ("Reach") and ADR-024.

**Blocked by:** REACH-03

**Status:** ready-for-agent

### Backend

- [ ] An Alembic revision renames `median_views` to `reach` and adds a boolean `reach_estimated`
- [ ] At probe time the entry's Reach is computed by the REACH-03 Reach function from its sample, each sample's age being the probe time minus its publication time, and stored on the entry
- [ ] An entry whose Channel is followed by any Account answers with the Post-based Reach instead of the stored one
- [ ] The wire field `medianViews` becomes `reach` plus `reachEstimated`
- [ ] A batched post-deploy script in `backend/scripts/` recomputes every existing entry's Reach from its stored samples, with `--dry-run`, idempotent, indexed in `development.md`
- [ ] A settling-age change reaches stored Directory Reach at each entry's next probe, with no recompute sweep
- [ ] Tests at `record_probe_result` (prior art: `tests/services/test_directory_statistics_write_path.py`): measured Reach when five samples are Settled, estimated Reach when fewer are Settled but five are past the floor, nothing when neither holds
- [ ] API test: a Directory entry of a followed Channel shows the Post-based Reach
- [ ] The Directory and Discover projection guards are updated, not deleted; the client is regenerated

### Frontend

- [ ] The Discover candidate table and panel show Reach with the estimate marker, and "not measured" for `null`
- [ ] The Discover sort key and its label become Reach; the settings schema maps the stored legacy "Median views" sort value to the new key, so a saved preference survives
- [ ] `types.conform.ts` is updated; the Discover statistic, sort and filter tests move to the new field rather than being deleted, and a test covers the legacy sort value mapping
- [ ] Every new guard and test is mutation-tested (watched red before trusted)
