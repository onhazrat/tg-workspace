# #135 🔒 Scope logs, administrative routes become Admin-only (ticket 18)

**State:** merged 2026-08-26 · **Branch:** `worktree-ticket-18-scope-logs-admin-routes` into `main` · **Diff:** +1793 / -69 across 18 files · **Opened:** 2026-08-26

---

A newly registered account can no longer reach database statistics, table clearing, import, export, the proxy list, the log purge, the scheduler, or the deployment's network logs. All of it was open to any authenticated person, which was invisible with one account and is the whole problem the moment there are two.

## Three permissions

Granted to Admin and Owner. No migration — `reconcile_seeded_roles` rewrites the seeded rows from the constants on every boot.

| Permission | Covers |
|---|---|
| `data:admin` | Statistics, table sizes, clearing a table, import, export, the log purge, the deployment's network settings. |
| `logs:read_any` | Log rows no single account owns. Network logs today. |
| `jobs:manage` | The scheduler, and a sync job nobody owns. |

`data:admin` is one permission rather than a read half and a write half — an auditor who may read table sizes but not clear them is a role nobody has asked for, and the day someone wants it, it is a constant plus a row in `rbac_roles`. `logs:read_any` is separate from it for the reason `quota:read_any` is separate from `users:read`.

## Two things the plan did not name

`GET /data/settings/network` returns `proxyUrls` — the actual URLs, credentials included — to any authenticated account. Reading it is as administrative as writing it, so both halves are gated.

A sync job with a null owner is the scheduler's, and answers **403 rather than 404**: there is no owner for a 404 to protect. Someone else's job is still 404, with the detail an absent job gets, through `assert_owner`.

## Log reads adopt the seam

`list_logs` and `get_log` take a required `user_id` with no default. `ADMIN_ONLY_LOG_TYPES` is one set read by both the route's gate and the service's scoping, so a family cannot end up readable by anyone *and* unscoped. Network logs go through `unscoped_select` with a reason and stay `USER_OWNED` in `SCOPES` — the escape hatch is only meaningful where the default would have scoped, the argument `QuotaUsage` already makes. Sync logs scope like the rest until ticket 19.

## Deliberately not gated

`GET`/`PUT /data/settings/{key}`, a facade over both settings tables. Gating it wholesale takes a person's own sync preferences away from them and breaks the frontend's Pause button; gating it per field means routing authorisation through `settings_registry` beside the storage routing, which is settings work. Deployment-policy keys reaching it is a real hole, recorded in the module docstring, the plan, and the guard's exemption map with the reason — and the guard fails if a *third* ungated route appears in that module.

## Guards

`tests/api/test_admin_route_gating.py` and `tests/services/test_log_tenancy_scoping.py`, both directions each. Six mutations were run and each killed the tests it should: scoping removed, owner check removed, a Python-side filter in place of the predicate, one route ungated, the whole log family gated, the unowned-job check removed.

One test did not survive that scrutiny and was rewritten — an assertion that the page is narrowed before it is ranked, which no honest mutation could fail because the wire projection drops `userId`. The SSE route is covered structurally rather than through the client, because a gate that fails there hangs the suite instead of failing it.

## Fallout

`test_approval_gate.py` used `GET /jobs/status` to show approval opening the data routes. That route now sits behind two gates that both answer 403, so it uses `GET /data/channels` instead.

Generated OpenAPI is byte-identical; the frontend and the generated client are untouched. Full backend suite: 1509 passed, 2 skipped.

Plan: `docs/admin-only-routes-and-log-scoping-plan.md`. Ticket: `.scratch/multi-user-tenancy/issues/18-scope-logs-administrative-routes-become-admin-only.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01LGKysgfW7RgxbadRkJKAQs

---

## Review round (commit 2)

`/code-review high` found six issues and was right on all of them. Five are one mistake: gating a route is free only if nothing calls it.

**Two real holes.** `POST /data/logs/{type}` upserts by a caller-supplied id and every `upsert_*_log` reassigns `user_id` on the way past, so posting another account's log id overwrote that row **and took ownership of it** — the shape ticket 17 found in the artifact families. And `PUT /data/settings/{key}` accepted `postRetentionDays: 1` from a plain account, which deletes every account's Posts on the next sweep. "A known hole" was too generous: that is table clearing on a timer, which is the thing this ticket exists to prevent.

**Four caller regressions.** `GET /jobs/status` inside a `Promise.all` rejected the whole `SettingsContext` hydration; `DELETE /data/logs` is also the per-row delete every Logs tab uses; gating the network log *write* silently stopped six non-Admin telemetry flows.

**And the one nobody predicted.** `isAuthFailure` treated *any* 403 as a dead session and called `clearStaleSession()` — token dropped, hard navigate to `/login`. Survivable only while an ordinary account never saw a 403. With these routes gated, a plain account's boot-time `GET /data/settings/network` would have signed it out on every attempt, forever. 401 means "I do not know who you are"; 403 means "I do, and no". Only `Inactive user` and a deleted subject still end a session, which also stops signing out an account merely awaiting approval, as ADR-011 always said should happen.

Ten mutations in total, each killing the tests it should. Backend 1524 passed / 2 skipped, frontend 882 passed, mypy + ty + ruff + biome clean. The generated client's only diff is JSDoc.
