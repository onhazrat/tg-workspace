# 18: Scope logs; administrative routes become Admin-only

**What to build:** A newly registered account cannot reach database statistics, table clearing, or import.

**Blocked by:** 03, 07

**Status:** done

- [x] Destructive and diagnostic administrative routes require Admin
- [x] Network logs and scheduled job records are Admin-only
- [x] A guard asserts each administrative route rejects a non-Admin

Two mechanisms that look like one, kept apart on purpose. RBAC decides whether
you may call a route at all and answers 403; the tenancy seam decides which rows
come back and answers 404. The seam half is still behind its flag and changes no
response yet. The RBAC half takes effect immediately, which is the ticket.

Three permissions, granted to Admin and Owner, no migration needed because
`reconcile_seeded_roles` rewrites the seeded rows from the constants on every
boot: `data:admin` (statistics, table sizes, clearing a table, import, export,
the log purge, the deployment's network settings), `logs:read_any` (log rows no
account owns), `jobs:manage` (the scheduler, and a sync job nobody owns).

`data:admin` is deliberately not split into a diagnostic half and a destructive
half. `logs:read_any` is deliberately separate from it, for the reason
`quota:read_any` is separate from `users:read` — proxy behaviour is a
behavioural record, and reading one is not the same as being able to drop a
table. The plan is `docs/admin-only-routes-and-log-scoping-plan.md`.

### Review found six things, and one of them was a sign-out loop

The first cut gated routes without following them to their callers. Worth
recording because five of the six are the same mistake:

* **`POST /data/logs/{type}` let one account overwrite and take over another's
  log row.** The write was in scope and the checkboxes did not say so — the
  same sentence ticket 17 had to write. `create_logs` now owner-checks any id
  that already exists, for all five types.
* **`PUT /data/settings/{key}` accepted `postRetentionDays: 1` from a plain
  account**, which deletes every account's Posts on the next sweep. Calling that
  "a known hole" was too generous: it is table clearing on a timer, which is the
  thing this ticket exists to prevent. Global keys are gated now; `sync` alone
  is narrowed to the registry's per-User fields.
* **`GET /jobs/status` sat inside a `Promise.all`** in `SettingsContext`, so one
  403 rejected the whole hydration and left the three settings-push effects
  permanently disabled behind a `console.error`.
* **`DELETE /data/logs` is also the per-row delete** every Logs tab uses; the
  gate moved to the two sweep branches, and the single-row branch owner-checks.
* **Gating the network log write** silently stopped recording six non-Admin
  telemetry flows, since `writeLog` swallows failures by design. Reverted.
* **`isAuthFailure` treated any 403 as a dead session** and called
  `clearStaleSession()`. Survivable only while an ordinary account never saw a
  403 — with these routes gated, a plain account's boot-time
  `GET /data/settings/network` would have dropped its token and bounced it to
  `/login`, forever. Only `Inactive user` and a deleted subject end a session
  now. That also stops signing out an account merely awaiting approval, which is
  what ADR-011 said should happen all along.

The lesson is one line: gating a route is free only if nothing calls it.

### The generic settings route, gated by key rather than by route

`GET`/`PUT /data/settings/{key}` carries no route-level dependency, which is why
the structural guard still lists it as an exemption. The gate is *inside* the
handler, because the key decides and the path cannot: a global key demands
`DATA_ADMIN`, and `sync` alone is narrowed rather than refused.

`sync` is a facade. One body reassembles deployment policy, scheduler runtime
and the caller's own preferences, and the frontend's Pause button writes a
global runtime field through it, so refusing the whole request would take a
person's own start-time preference away from them. For a caller without the
permission the body is narrowed to `SYNC_PREF_FIELDS` — the registry's own
answer to which half is personal, so this invents no new knowledge and moves
with the fields if they ever move. Dropping rather than refusing, because the
frontend sends a whole section at once and a non-Admin saving their preferences
should not be told the save failed when the half that is theirs succeeded.

The `GET` stays open on purpose. Gating it would repeat the caller regression
review found three times over: `SettingsContext` hydrates `sync`, `retention`
and `translation` for every signed-in person.

### `GET /data/settings/network` was not on anyone's list

The plan names `clear_table`, `get_db_stats`, `get_table_sizes` and
`import_data_impl`. The network settings route is in the same module and
returns `proxyUrls` — the actual URLs, credentials included — to any
authenticated account. Reading it is as administrative as writing it, so both
halves are gated. It is dedicated route rather than part of the `{key}` facade,
so there was no per-User half to break.

### A job with no owner is 403, not 404

Decision 23 keeps a nullable `user_id` on scheduled sync jobs so that a row
nobody claims leaks to an Admin and to nobody else. `_visible_job` in
`routes/jobs.py` is the rule for all three `/jobs/sync/{job_id}` routes: absent
is 404; someone else's is 404 with the same detail, through `assert_owner`;
nobody's is 403 unless the caller can manage the scheduler. The last of those is
an authorisation answer about a deployment record — there is no owner for a 404
to protect, so pretending otherwise would only make the Admin's own view harder
to explain.

### Log reads adopt the seam; network logs are the exception both ways

`list_logs` and `get_log` take a required `user_id` with no default and go
through `scoped_select`/`assert_owner`. `ADMIN_ONLY_LOG_TYPES` is one set read
by both the route's gate and the service's scoping, so those two cannot come to
disagree about which types are administrative — a family readable by anyone
*and* unscoped is the worst of both. Network logs go through `unscoped_select`
with a reason and stay `USER_OWNED` in `SCOPES`, because an escape hatch is only
meaningful where the default would have scoped, which is the argument
`QuotaUsage` already makes. Sync logs scope like the rest until ticket 19 turns
them into channel telemetry.

### Guards, all mutation-tested

`tests/api/test_admin_route_gating.py`: every administrative route refuses a
plain user with the permission refusal string (safe to run against the
destructive ones, because a refusal happens before the handler); an Admin still
reaches a safe subset; every route mounted from `routes/data/admin.py` is gated
or excused with a reason, walked from the app rather than a hand-kept list; and
both directions on log types, since "network is refused" would pass just as well
if the whole family had become Admin-only.

`tests/services/test_log_tenancy_scoping.py`: your own rows and not another
account's, byte-identical with the flag off, a foreign row by id is 404 with the
string an absent row gets, and network logs unscoped in both flag states.

Ten mutations were run and each killed the tests it should: read scoping
removed, the by-id owner check removed, a Python-side filter in place of the
predicate, one route ungated, the whole log family gated, the unowned-job check
removed, the log-write owner check removed, the global-settings gate removed,
the `sync` narrowing removed, and the per-row delete's owner check removed.

One test did not survive that scrutiny and was rewritten — an assertion that the
page is narrowed before it is ranked, which no honest mutation could fail
because the wire projection drops `userId`, so there is nothing left to filter
on afterwards.

The frontend half is pinned by `src/api/auth-failure.test.ts`, in both
directions: an ordinary refusal and a pending account keep their session, while
an account switched off mid-session and a deleted subject still lose it.

The SSE route is covered structurally rather than through the client, because a
gate that fails there hangs the suite instead of failing it, and a guard whose
failure mode is a hung suite teaches nobody anything.

### Fallout

`tests/api/test_approval_gate.py` used `GET /jobs/status` to show that approval
opens the data routes. That route now sits behind two gates that both answer
403, so it could no longer show that the first one opened; it uses
`GET /data/channels` instead.

Three frontend files changed, all of them callers of routes this ticket gated:
`api/base.ts` (the sign-out rule), `contexts/SettingsContext.tsx` (the optional
`jobsStatus` call), and `lib/settings/use-network-settings.ts` (a 403 is an
answer, not a fault).

The generated client's only diff is JSDoc: no operation id, signature or type
moved, because no request or response model did.

Backend: 1524 passed, 2 skipped. Frontend: 882 passed. mypy, ty, ruff and biome
clean.
