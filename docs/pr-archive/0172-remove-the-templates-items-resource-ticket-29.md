# #172 🗑️ Remove the template's items resource (ticket 29)

**State:** merged 2026-09-03 · **Branch:** `ticket-29-remove-items` into `main` · **Diff:** +114 / -1777 across 38 files · **Opened:** 2026-09-03

---

Closes ticket 29 of the multi-user tenancy programme (`.scratch/multi-user-tenancy/issues/29-remove-items.md`).

`Item` was the FastAPI template's demo resource, kept through the migration as the one worked example of owner-scoped access. `services/tenancy.py` is that example now, for 27 tables rather than one, so the demo is dead weight a reader has to be told to ignore — `OUT_OF_SCOPE` said exactly that in prose until this change deleted the need for it.

## What goes

Five routes, six `Item*` models, `User.items`, `crud.create_item`, the `items:manage_any` permission, the `/items` page with `components/Items/` and `PendingItems`, the sidebar entry, and both test suites. Migration `f5a6b7c8d9e0` drops the table.

RBAC needs no data migration. `reconcile_seeded_roles` rewrites a seeded role whenever its permission list differs from `SEEDED_ROLES`, so `items:manage_any` comes off Admin and Owner on the next boot. The string stays spelled out in `b0c1d2e3f4a5` because an applied revision has to keep meaning what it meant.

## Two guards needed a replacement, not a deletion

`frontend/src/api/sdk-call-shape.test.ts` used `itemsUpdateItem` as one of its two path-param-plus-body cases. It now uses `dataUpdateSettingGroup`, which carries the same hazard — a path param and a closed body that could be swapped and still compile — and keeps one call from `users` and one from `data`.

`tests/services/test_tenancy_seam.py` justified its recursive model walk with "`User` and `Item` descend from `UserBase`/`ItemBase`". `User` alone still needs the recursion, and the docstring says so.

## One number corrected

Dropping five routes takes `test_account_isolation.py`'s inventory to 138 operations. CLAUDE.md claimed 135 and was already stale by eight.

## Verification

2147 backend tests pass (3 skipped), 901 frontend unit tests pass, mypy + ty + ruff + biome clean, frontend build green, `alembic check` shows no `item` drift. CI is billing-blocked, so expect no checks here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01PSc9tMaH8ybjiqfm73c48t
