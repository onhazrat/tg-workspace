# 04: Follow table, backfill, dual-write

**What to build:** Every existing Channel gains a Follow row owned by the current superuser, and every path that creates a Channel now also writes a Follow. Nothing reads Follows yet, so behaviour is unchanged.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The Follow table exists with a composite natural key, cascading keys both sides, and an index for the follower-lookup direction
- [ ] It carries the per-User fields currently on the Channel, plus its own next-sync field
- [ ] A dry-runnable, idempotent backfill creates one Follow per existing Channel
- [ ] A read-only audit reports null and orphan owners, Channels with no Follow, and unowned settings
- [ ] All Channel-creation paths write a Follow
