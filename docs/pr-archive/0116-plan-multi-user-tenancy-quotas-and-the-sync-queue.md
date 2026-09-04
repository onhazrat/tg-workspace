# #116 📝 Plan multi-user tenancy, quotas, and the sync queue

**State:** merged 2026-08-23 · **Branch:** `docs/multi-user-tenancy-plan` into `main` · **Diff:** +1613 / -0 across 36 files · **Opened:** 2026-08-23

---

Design only, no behaviour change. Moves off Mode A (one superuser owning all data) to real multi-tenancy with a **shared corpus and private outputs**, plus the queue work the quota tiers depend on.

## What's here

| File | |
|---|---|
| `docs/multi-user-tenancy-plan.md` | design, migration ordering, guards |
| `docs/multi-user-tenancy-spec.md` | spec, 70 user stories |
| `docs/multi-user-tenancy-tickets.md` | 29-ticket breakdown |
| `.scratch/multi-user-tenancy/issues/` | one file per ticket |
| `docs/agents/` | skills config: local tracker, default triage labels, single-context domain docs |

## Two findings that shaped it

**The corpus is already physically shared.** Channels are keyed by handle, posts are unique per `(channel_name, post_id)`, and embeddings and translations are keyed the same way with `user_id` never populated. The schema cannot hold two users' copies of anything, so that column was only ever a "who created this first" stamp. No de-duplication work is needed; what's missing is a follow relation.

**But the read path isn't operator-scoped at all today.** `services/channels.py:311` is a bare `select(Channel)`, as are the bios, stats, posts, discover, RAG, artifacts, and export readers. Replacing `operator.py` is ~15% of the scoping work; the rest is ~40 queries that never had an owner filter.

## Four pre-existing auth bugs found while reading

Ticket 01 covers all four. The sharpest two:

- **Password recovery is unreachable in staging and production.** The middleware exempts `/api/v1/login*`, but the recovery routes are mounted at `/api/v1/password-recovery/` and `/api/v1/reset-password/`, so a logged-out browser is rejected before FastAPI sees the request.
- **With SMTP unconfigured (the shipped default), the same endpoint 500s for a real address and 200s for an unknown one**, defeating the enumeration hardening the code deliberately added.

## Deliberately deferred

Most-eager-wins scheduling, shared-cost attribution, and the poll/backfill split wait until there are enough shared channels to justify them. Per-channel mutual exclusion is **not** deferred: it's a correctness bug, not an optimisation, since concurrent syncs interleave writes to a channel's history cursors.

## Note

This reverses a locked decision. `docs/migration/DECISIONS.md` specifies `USERS_OPEN_REGISTRATION=false` in production with a single superuser owning all data. That record, `ADR-002`, `CLAUDE.md`, `development.md`, and `deployment.md` are updated in the implementation phase, not here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
