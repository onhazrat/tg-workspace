# 29: Remove items

**What to build:** The template's demo resource is removed. It was kept as the reference implementation of owner-scoped access, and the tenancy seam has now replaced it.

**Blocked by:** 21

**Status:** done

- [x] Its routes, models, relationship, and interface are removed
- [x] Its table is dropped
- [x] Its tests go, including one of the three known-failing browser specs
- [x] Repository guidance no longer references it as the example

## What landed

`app/api/routes/items.py`, the six `Item*` models, `User.items`, `crud.create_item`
and the `items:manage_any` permission are gone; migration `f5a6b7c8d9e0` drops the
`item` table. `reconcile_seeded_roles` takes the permission off the Admin and Owner
rows on the next boot, so no data migration is needed for RBAC.

The route removal made `test_account_isolation.py` drop five `COVERED_ELSEWHERE`
entries, so its inventory is 138 operations rather than 143 — CLAUDE.md said 135
and was stale before this ticket touched it.

Two guards had borrowed the demo resource and needed a replacement rather than a
deletion:

- `frontend/src/api/sdk-call-shape.test.ts` used `itemsUpdateItem` as one of its
  two path-param-plus-body cases. It now uses `dataUpdateSettingGroup`, keeping
  one call from `users` and one from `data`.
- `tests/services/test_tenancy_seam.py` justified its recursive model walk with
  "`User` and `Item` descend from `UserBase`/`ItemBase`". `User` alone still needs
  the recursion, and the docstring now says so.

Frontend: the `/items` route, `components/Items/`, `PendingItems`, the sidebar
entry and `tests/items.spec.ts` are removed, and `routeTree.gen.ts` plus the
generated client were regenerated.
