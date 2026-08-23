# 20: Split retention four ways

**What to build:** Post retention is a deployment policy an Admin sets once. Log and report retention stay personal. One person's settings can never delete another's evidence.

**Blocked by:** 03, 04, 06

**Status:** ready-for-agent

- [ ] Post, embedding, translation, and sync-state sweeps run on the single deployment policy
- [ ] Log sweeps run per User on that User's window
- [ ] Discovery report pruning is per-User, not across the whole table
- [ ] Channels with no Followers are collected
- [ ] Asset pruning stays global
