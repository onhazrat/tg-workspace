# #122 🔒 Tenancy seam behind a disabled flag (ticket 03)

**State:** merged 2026-08-24 · **Branch:** `ticket-03-tenancy-seam` into `main` · **Diff:** +893 / -6 across 8 files · **Opened:** 2026-08-24

---

Adds `app/services/tenancy.py`, the one place that answers "which rows may this User see". It ships **inert**: `TENANCY_ENFORCED` defaults to `False`, and while it is off `scoped_select` returns the caller's statement untouched, so the ~40 read paths that never had an owner filter can adopt the seam one batch at a time without any batch changing a response. Ticket 21 flips the flag once an isolation guard proves it.

## Why a classification and not a `user_id` filter

The obvious version of this module is one line — `.where(Model.user_id == user_id)` — and it is wrong for most of the schema. The corpus is already physically shared: `Channel.id` is the handle, `Post` is unique per `(channel_name, post_id)`, and embeddings and translations are keyed the same way. `user_id` on those tables was only ever a "who scraped this first" stamp, and filtering on it would hand the second follower of a channel an empty page for posts sitting right there.

So dispatch is by model class, and every table is placed or excused with a written reason:

| Scope | Tables | Rule |
|---|---|---|
| user-owned | 18 | `.where(Model.user_id == user_id)` |
| follow-scoped | 5 | `EXISTS` against `tg_channel_follows` (ticket 04) |
| corpus | 2 | unscoped, deliberately |
| out of scope | `User`, `Item`, `Role`, `UserRole` | reason recorded per entry |

`DiscoverHandleProbe` and `SyncMeta` are corpus because a probe is a fact about a handle ("cannot be followed by anyone") and an etag is a cache marker. That is worth writing down precisely because an unscoped read is otherwise indistinguishable from a forgotten one.

## One branch is deliberately unfinished

`tg_channel_follows` arrives in ticket 04, so a follow-scoped model asked to scope **raises**, naming that ticket. Both alternatives are worse: returning the unscoped statement leaks another account's corpus the moment the flag flips, and returning an empty one is a silent outage. A raise makes an early flip a crash on the first query. `FOLLOW_KEYS` records the join column ticket 04 needs.

## The 404 is only half an answer

`assert_owner` refuses a foreign row as 404 rather than 403 — 403 confirms the row exists, the same enumeration oracle signup was hardened against. But every 404 in this codebase names its resource (`"Summary not found"`, `f"{log_type} log not found"`), so a generic `"Not found"` would move that oracle into the response body rather than close it. `detail` is a **required** keyword argument with no default, because the default is the trap. `unscoped_select(statement, reason=...)` is the matching escape hatch for reads that cross accounts on purpose (Admin export, `routes/data/admin.py`): a no-op by construction whose only job is to make the call site greppable.

## Guards

`tests/services/test_tenancy_seam.py`, 48 tests, registered as a pure transform in `test_service_kinds.py` so acquiring a `Session` later turns the suite red.

Fifteen mutations were run and each watched to fail. Four of those guards were holes found by review or by mutation, and all four are the same shape — a check that knows one spelling of the thing it forbids:

- `User` and `Item` descend from `UserBase`/`ItemBase`, so one level of `SQLModel.__subclasses__()` missed exactly the two template tables
- the model walk named three modules instead of finding them, so a table in a fourth would have been invisible
- the `Session` check read only `FunctionDef.args.args`, so a keyword-only one on an `async def` passed
- the flag scan covered `app/` but not the `scripts/` directory the audit tooling lands in

## Verification

`mypy` / `ty` / `ruff` clean. Full backend suite: **1204 passed, 2 skipped**. No migration, no API change, no frontend change.

Closes ticket 03.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
