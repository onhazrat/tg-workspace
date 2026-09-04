# #176 Retire the global setting-group scope (ticket 37)

**State:** merged 2026-09-04 · **Branch:** `ticket-37-retire-global-setting-group-scope` into `main` · **Diff:** +573 / -124 across 8 files · **Opened:** 2026-09-04

---

The name-collision filter on `tg_channel_setting_groups` was deliberately wider than the unique index it mirrors: `me OR user_id IS NULL`, so a custom group could not take an ownerless preset's name. Ticket 21 deleted those rows and made the column `NOT NULL` with a cascading key, which left the wider leg unable to match anything and the index's `COALESCE` unable to produce `'global'`.

So the filter is `user_id == me` now, and the change is a no-op to behaviour by arithmetic rather than by argument. That is exactly why it needed a guard: the two only agree because a migration made them, and nothing was watching.

### The ticket said something else, and it was stale

Ticket 37 as filed asked for a three-way decision about the ownerless preset rows, on the belief that they still existed. They do not. It was the second forward reference in this tracker to expire between filing and pickup, after ticket 13's in `sync_queue.py`, so the ticket file now records the expiry rather than quietly dropping it.

### What changed

- `_name_collision_scope_filter` is `user_id == me`. Its docstring carries both halves of the argument: that the index's `COALESCE` is a fossil the two now agree through, and why the index was left alone.
- The index is **not** rewritten. `(user_id, lower(name))` buys a uuid comparison instead of a text one and costs a rebuild under `ACCESS EXCLUSIVE` on the table whose correctness depends on it. The losing argument lives in the docstring, not only here.
- `scope_key(None)` answered `"global"` and fed five reserved-id builders, so `default-global` stayed a constructible id for a row that can no longer be inserted. Nine signatures narrowed to `uuid.UUID`. `create_setting_group`'s docstring already claimed "the owner is non-optional for the reason the five constructors above are"; it is true now.
- `PUT /data/channels/{id}` says at the handler that it is also the follow-an-existing-Channel path.
- `CLAUDE.md` no longer claims the owner columns are nullable. The `user_id=None` creation-path clause was checked rather than inverted.

### The guard asserts the reason, not the query

With the unowned leg gone the filter reads byte-for-byte like `scoped_select` output for a `USER_OWNED` table, so the next person simplifying this module will reach for the seam on sight. Gating it would make a duplicate name stop being rejected while `TENANCY_ENFORCED` is off and arrive as a Postgres `UniqueViolation` instead of the route's 409. `tests/services/test_setting_group_name_identity.py` fails on either half.

Ten mutations were applied and each watched to fail the one row naming it. Six on the rule; four on the source scan itself after review found it evadable: a flag call hidden behind a triple-quoted block, the optional owner spelled `Optional[uuid.UUID]` and `None | uuid.UUID`, and the scope reintroduced on an `async def`.

### Verification

- Full backend suite twice: 2244 passed, 3 skipped.
- mypy (172 files), `ty check app`, ruff check + format, frontend `tsc` all clean.
- Staging read before writing any of this, on real data: `alembic_version` is `a2b3c4d5e6f7` (head, eight revisions past `d2e3f4a5b6c7`), `tg_channel_setting_groups` holds 0 rows with `user_id IS NULL`, and the column reports `is_nullable = NO`. The narrowing is therefore a no-op there too.

### One thing reviewers should know

The route docstring regenerated the client, so `frontend/openapi.json` and `sdk.gen.ts` are in the diff. Review found the first cut was shipping ticket numbers and a test path into the public SDK; the provenance is a `#` comment above the decorator now, and only the two API-meaningful sentences are the docstring.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01AEcDsUQMrgmVd53AUJuU2E
