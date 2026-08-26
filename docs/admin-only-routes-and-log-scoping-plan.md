# Ticket 18: scope logs, and administrative routes become Admin-only

**Goal, in the ticket's words:** a newly registered account cannot reach database statistics, table
clearing, or import.

Two halves that look like one. The first is authorisation: a set of routes that answer for the whole
deployment stop being reachable by any authenticated account and start naming a permission. The
second is row visibility: log reads adopt the tenancy seam from ticket 03, so a log row belongs to
the account that produced it.

They are separate mechanisms and must stay separate. RBAC decides *whether you may call this at
all* and answers 403; the seam decides *which rows come back* and answers 404. The seam is still
behind `TENANCY_ENFORCED=False`, so its half of this ticket changes no response yet. The RBAC half
takes effect immediately, which is the point of the ticket.

## Three new permissions

Added to `app/core/permissions.py` and granted to Admin and Owner. No migration:
`reconcile_seeded_roles` runs on every boot and rewrites the three seeded rows from the constants.

| Permission | Covers |
|---|---|
| `data:admin` | Database statistics, table sizes, clearing a table, import, export, the log purge, and the deployment's network settings. |
| `logs:read_any` | Log rows no single account owns. Network logs today. |
| `jobs:manage` | The scheduler: read job status, enable or disable a job, trigger a run, and read a sync job nobody owns. |

`data:admin` is one permission rather than a read half and a write half. An auditor who may read
table sizes but not clear them is a role nobody has asked for, and the day someone wants it, it is a
constant here plus a row in `rbac_roles`, which is what roles-as-data buys.

`logs:read_any` is separate from `data:admin` for the reason `quota:read_any` is separate from
`users:read`: reading what a deployment's proxies did is a behavioural record, and the auditor role
the spec keeps in view might want that without the ability to drop a table.

## Routes that become Admin-only

From `routes/data/admin.py`, the module the plan names outright:

- `GET /data/stats`, `GET /data/table-sizes` are diagnostic and read across every account.
- `DELETE /data/tables/{name}` is the destructive one. It clears a whole table for everybody.
- `POST /data/import` overwrites rows by id, and `GET /data/export` streams every account's rows.
- `GET`/`PUT /data/settings/network` hold the proxy list, which is deployment policy by decision 21
  and carries credentials in the URLs. Reading it is as administrative as writing it.

From `routes/data/logs.py`:

- `DELETE /data/logs` purges log rows across every account. Per-account log pruning is ticket 20's
  four-way retention split, and this route is not it.
- `GET /data/logs/network` and its detail route require `logs:read_any`. The other four types stay
  open to any approved account and are narrowed by the seam instead.

From `routes/jobs.py`:

- `GET /jobs/status`, `POST /jobs/{job_id}/trigger`, `PUT /jobs/{job_id}`. Triggering `retention`
  deletes posts, so this is a destructive route wearing a status route's clothes.
- `GET /jobs/sync/{job_id}`, its SSE stream, and its cancel, **only when the job has no owner**. A
  job you started is yours to watch. Decision 23 keeps a nullable owner on scheduled jobs precisely
  so that a row nobody claims leaks to an Admin and to nobody else.

### What is deliberately not gated

`GET`/`PUT /data/settings/{key}`. It is a facade over both tables: `sync` reassembles deployment
policy, scheduler runtime, and the caller's own preferences into one blob, and the frontend's Pause
button writes a runtime field through it. Gating the route wholesale would take a person's own sync
preferences away from them; gating it per field means routing authorisation through
`settings_registry` alongside the storage routing. That is a real hole for deployment policy keys
and it is written down here rather than half-closed: it belongs with the settings work, not with
this ticket's checkboxes.

`POST /data/logs/{log_type}` for the four owned types. It stamps the caller's id on what it writes,
so it is already per-account. The network type is gated there too, by the same per-type dependency
as the reads: an account that may not read the deployment's proxy log has no business writing rows
into it, and one set of admin-only types rather than a read list and a write list is what stops those
two from drifting apart.

### Two things this changed that the plan did not predict

`tests/api/test_approval_gate.py` used `GET /jobs/status` as its example of a data route that
approval opens. That route is now behind two gates that both answer 403, so it could no longer show
that the first one opened; it uses `GET /data/channels` instead, which the same file already uses
elsewhere for the same purpose.

The first cut of the seam guard had a test asserting the page is narrowed before it is ranked, which
survived no honest mutation: the wire projection drops `userId`, so a post-hoc Python filter cannot
even be written. It was rewritten to assert the observable consequence, that a full page of another
account's newer rows does not crowd yours out.

## Log reads adopt the seam

`list_logs` and `get_log` take a required `user_id` and go through `scoped_select` / `assert_owner`,
the way `services/summaries.py` does after ticket 17. Publish, sync, LLM and embedding logs are
`USER_OWNED` in `SCOPES` and scope on the owner column. Sync logs become channel telemetry in ticket
19; until then they scope like the rest, which is byte-identical while the flag is off either way.

Network logs go through `unscoped_select` with a reason. They stay `USER_OWNED` in `SCOPES`, because
the escape hatch is only meaningful where the default would have scoped, which is the argument
`QuotaUsage` already makes. The route above them is what keeps them Admin-only.

`get_log` passes `f"{log_type} log not found"` as the `assert_owner` detail, the string that route
already answers for a row that is not there. Matching it is the requirement; tidying it would reopen
the enumeration oracle the 404 exists to close.

## The guard

`tests/api/test_admin_route_gating.py`, in both directions.

1. Every route in the inventory refuses a plain user with 403 and the standard detail. Safe to run
   against the destructive ones too, because a refusal happens before the handler.
2. The Admin still reaches a safe subset, so the ticket cannot be "passed" by breaking everything.
3. Structural: every route mounted from `routes/data/admin.py` either carries a `require_permission`
   dependency or appears in an exceptions map with a reason. A new route added to that module and
   left ungated fails here rather than in production.
4. Both directions on the log types: `network` is refused, `publish` is not.

`tests/services/test_log_tenancy_scoping.py` covers the seam half with the flag forced on: your own
log rows come back, another account's do not, a foreign row by id is 404 with that type's own detail,
and network logs stay unscoped in both flag states.

Every one of these was mutation-tested by breaking the thing it guards and watching it go red.

## What review changed

The first cut gated a set of routes without following them to their callers, and scoped log *reads*
while leaving the writes open. Six findings, and the plan above is written as it ended up rather than
as it started.

**The writes were in scope.** `POST /data/logs/{type}` upserts by a caller-supplied id and every
`upsert_*_log` reassigns `user_id` on the way past, so posting another account's log id overwrote
that row and took ownership of it, with every read guard passing. Exactly the shape ticket 17 found
in the four artifact families. `create_logs` now refuses a write that lands on somebody else's row,
for all five types.

**"A known hole" was too generous to `PUT /data/settings/{key}`.** With a plain token it accepted
`retention` → `postRetentionDays: 1`, which deletes every account's Posts on the next sweep. That is
table clearing on a timer, and not reaching table clearing is this ticket's stated goal. Global keys
now demand the permission; `sync` alone is narrowed to `SYNC_PREF_FIELDS`, which is the registry's
own answer to which half of that blob is personal.

**Gating a route is not free if something already calls it.** `GET /jobs/status` sat inside a
`Promise.all` in `SettingsContext`, so one 403 rejected the whole hydration and left the three
settings-push effects permanently disabled behind a `console.error`. `DELETE /data/logs` is also the
per-row delete every Logs tab uses. Gating the network log *write* silently stopped recording six
non-Admin telemetry flows, because `writeLog` swallows failures by design.

**And the one nobody predicted.** `isAuthFailure` in `frontend/src/api/base.ts` treated *any* 403 as
a dead session and called `clearStaleSession()`, which drops the token and hard-navigates to
`/login`. That was survivable only while an ordinary account never saw a 403. With these routes
gated, a plain account's boot-time `GET /data/settings/network` would have signed it out, on every
attempt, forever. 401 means "I do not know who you are"; 403 means "I do, and no". Only
`Inactive user` and a deleted subject still end the session. This also stops signing out an account
that is merely awaiting approval, which is what ADR-011 said should happen all along.
