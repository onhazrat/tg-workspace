# 22: Drop the superseded columns (contract)

**What to build:** The corpus owner columns and the Channel columns that moved to the Follow are gone, so nothing can drift back to using them.

**Blocked by:** 21

**Status:** ready-for-agent

- [ ] Owner columns are dropped from the corpus tables
- [ ] The migrated per-User columns are dropped from the Channel
- [ ] A guard asserts corpus models carry no owner and no module references one, stating the reason
- [ ] The guard has been watched to fail
