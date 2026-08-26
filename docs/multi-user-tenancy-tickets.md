# Ticket breakdown: multi-user, quotas, and the sync queue

Approved breakdown, **not yet published**. Destination pending `/setup-matt-pocock-skills`.
When published, each ticket below becomes one issue (or one file), in the numbered order, with
`ready-for-agent` applied. Source documents: the spec and plan in this directory.

Nine tickets can start immediately: 1, 2, 3, 4, 6, 7, 8, 9.

**Wide refactor treatment.** Read scoping touches ~40 unscoped queries and ~93 handlers that receive
the authenticated User and discard it. No vertical slice of that lands green alone, so it is sequenced
expand–contract: ticket 3 expands (the seam exists, enforcement disabled, queries unchanged), tickets
15–20 migrate in batches sized by blast radius, ticket 21 is the integrate-and-verify where green is
promised, ticket 22 contracts.

---

## 1. Harden the auth flows
**Blocked by:** None (can start immediately)

**What to build:** A person who forgot their password can request a reset link on the deployed
instance and receive one. The endpoint answers identically whether or not the address has an account.
Registration and login are rate limited at the edge.

- [ ] Password recovery and reset are reachable for a logged-out browser in staging and production
- [ ] With mail unconfigured, a known and an unknown address produce the same response and no error
- [ ] Registration and login are rate limited at the reverse proxy
- [ ] The API key comparison is constant-time
- [ ] A guard asserts every route without an auth dependency is also exempt from the auth middleware, and it has been watched to fail

## 2. Clear the browser on logout
**Blocked by:** None (can start immediately)

**What to build:** Logging out leaves nothing behind on a shared machine. Stored preferences are
namespaced per account, so signing in as someone else never inherits the previous person's selection,
filters, or settings.

- [ ] Logging out clears the cached server state as well as the token
- [ ] Stored preferences are namespaced by the account identifier taken from the session token
- [ ] The token and the theme preference remain device-scoped, with the reason recorded
- [ ] Existing unnamespaced values migrate once on first read under a new namespace
- [ ] A guard asserts only the storage module, theme provider, transport, and auth hook touch browser storage

## 3. Tenancy seam behind a disabled flag (expand)
**Blocked by:** None (can start immediately)

**What to build:** No user-visible change. The scoping helpers exist, are classified and registered,
and generate queries identical to today's while enforcement is off, so later tickets can adopt them
one batch at a time without changing behaviour.

- [ ] A scoping helper, an ownership assertion, and the model classification exist
- [ ] The module is a pure transform: it builds queries and compares identifiers, executes nothing
- [ ] It is registered in the service-kind inventory, so acquiring database access later fails the suite
- [ ] The enforcement flag is read in exactly one function, asserted by a guard
- [ ] With enforcement off, generated queries are unchanged and the whole suite is green

## 4. Follow table, backfill, dual-write
**Blocked by:** None (can start immediately)

**What to build:** Every existing Channel gains a Follow row owned by the current superuser, and every
path that creates a Channel now also writes a Follow. Nothing reads Follows yet, so behaviour is
unchanged.

- [ ] The Follow table exists with a composite natural key, cascading keys both sides, and an index for the follower-lookup direction
- [ ] It carries the per-User fields currently on the Channel, plus its own next-sync field
- [ ] A dry-runnable, idempotent backfill creates one Follow per existing Channel
- [ ] A read-only audit reports null and orphan owners, Channels with no Follow, and unowned settings
- [ ] All Channel-creation paths write a Follow

## 5. Split unfollow from delete
**Blocked by:** 4

**What to build:** Removing a Channel takes it off your list and leaves its Posts alone. Channels
nobody Follows are collected later by retention rather than deleted on the spot.

- [ ] The removal action drops the Follow, not the Channel
- [ ] Posts of the Channel are untouched by removal
- [ ] A Channel with no remaining Followers is collected by retention
- [ ] A test proves a second account's Posts survive the first account's removal

## 6. Split global and per-user settings
**Blocked by:** None (can start immediately)

**What to build:** Deployment settings and personal settings live apart. Scheduler state stops being
something any User can overwrite. No visible change yet.

- [ ] Global settings and per-User settings are separate tables with distinct keys
- [ ] Scheduler runtime state moves to the global table
- [ ] All writers thread the owner; a guard asserts no global key is written to the per-User table or the reverse
- [ ] The data move is behaviour-neutral and safe to run unattended

## 7. RBAC tables, permission constants, seeded roles
**Blocked by:** None (can start immediately)

**What to build:** User, Admin, and Owner exist as real roles. The current superuser becomes an Admin.
Authorisation checks name a permission, not a role, so a fourth role is data rather than a migration.

- [ ] Role and assignment tables exist, seeded with the three roles
- [ ] Permission constants exist and call sites check them, never a role name
- [ ] The existing superuser maps to Admin with no loss of access
- [ ] The approval flag exists, separate from the active flag, defaulting to approved

## 8. Quota ledger, Request counting, observe only
**Blocked by:** None (can start immediately)

**What to build:** An Admin can see how many Requests each User consumed today, per Budget. Nothing is
throttled; this is measurement before enforcement.

- [ ] The ledger records one row per User, per day, per Budget
- [ ] Requests reaching Telegram are counted, including error responses; retries and transport failures are not
- [ ] Counting happens at sync completion, charging the actual Request count
- [ ] Ledger rows are never pruned
- [ ] An Admin view shows per-User usage

## 9. PGMQ install and the first lane end to end
**Blocked by:** None (can start immediately)

**What to build:** A manual single-Channel sync travels through a real durable queue instead of an
in-process call, and the person triggering it sees the same result as before.

- [ ] The queue is installed from a migration, needing no image change and no superuser privilege
- [ ] One lane exists and a manual single sync is enqueued and consumed through it
- [ ] Progress still reaches the browser unchanged
- [ ] The visibility timeout is set from the expected worst case, with redelivery capped and exhausted messages archived

## 10. Move the scheduler into a worker process
**Blocked by:** 9

**What to build:** Automatic sync runs outside the web process. Restarting or deploying the API no
longer interrupts syncing.

- [ ] The scheduler runs in its own process consuming the queue
- [ ] One message per Channel sync, never one per tick
- [ ] A bulk sync remains one job with aggregate progress, its messages carrying the job identity
- [ ] The web process no longer schedules work

## 11. Per-Channel claim, coalescing, mutual exclusion
**Blocked by:** 10

**What to build:** Two people syncing the same Channel at once cannot corrupt its history cursors, and
the second request rides the first rather than repeating the work.

- [ ] Only one sync per Channel runs at a time, enforced outside process memory
- [ ] A request finding one in flight waits for it, reports its result, and is not charged
- [ ] The scheduling deadline advances on completion only; the in-flight claim is a separate field that expires on its own
- [ ] A crashed worker's Channel is picked up again without manual intervention
- [ ] A guard proves concurrent syncs do not interleave cursor writes

## 12. Remaining five lanes and weighted draining
**Blocked by:** 10

**What to build:** All six queues exist. Normal-priority work always drains before best-effort, and a
steady trickle of manual work cannot starve automatic sync.

- [ ] Six lanes exist: automatic, manual bulk, manual single, each normal and best-effort
- [ ] Draining is strict between tiers and weighted within one, favouring single, then bulk, then automatic
- [ ] Messages are enqueued interleaved across Users
- [ ] An Admin can pause or drain a single lane

## 13. One worker per proxy
**Blocked by:** 10

**What to build:** Each worker owns one proxy and holds a long-lived connection to it, so the rate any
one proxy sees is predictable and capacity honestly reflects available proxies.

- [ ] Worker count derives from proxy count
- [ ] A worker whose proxy is in cooldown parks until it recovers
- [ ] The shared per-proxy concurrency gate is replaced by partitioning
- [ ] The worker-count guard is updated to assert the reasons that remain, not deleted

## 14. Adaptive per-proxy wait
**Blocked by:** 13

**What to build:** The scraper widens its wait after rejections and narrows it again on sustained
success, per proxy, so we stop provoking rate limits without staying permanently slow.

- [ ] Wait state is held per proxy and survives across requests
- [ ] Explicit rejection or soft block widens it multiplicatively; sustained success narrows it gradually
- [ ] Latency drift contributes as a weak signal
- [ ] Behaviour is observable in telemetry

## 15. Scope Channels and Follows (migrate 1)
**Blocked by:** 3, 4

**What to build:** With enforcement on, your Channel list shows only Channels you Follow. With it off,
nothing changes.

- [ ] Channel list, bios, and stats read through the scoping helper
- [ ] Per-Channel settings are read from the Follow, not the Channel
- [ ] The payload shape is unchanged and the generated client stays valid
- [ ] Both flag states are green

## 16. Scope Posts, feed, Discover (migrate 2)
**Blocked by:** 3, 4

**What to build:** Post reads, the feed, counts, and Discover draw only from Channels you Follow.

- [ ] Feed, lookup, counts, and Discover read through the scoping helper
- [ ] Handle probes remain unscoped, deliberately and with the reason recorded
- [ ] Both flag states are green

## 17. Scope Artifacts (migrate 3)
**Blocked by:** 3

**What to build:** Summaries, Chats, Tag runs, and Discovery reports are private, in their own lists
and in the unified History.

- [ ] All four Artifact families and the unified History read through the scoping helper
- [ ] Fetching another account's Artifact returns not-found, not forbidden
- [ ] Both flag states are green

## 18. Scope logs; administrative routes become Admin-only
**Blocked by:** 3, 7

**What to build:** A newly registered account cannot reach database statistics, table clearing, or
import.

- [ ] Destructive and diagnostic administrative routes require Admin
- [ ] Network logs and scheduled job records are Admin-only
- [ ] A guard asserts each administrative route rejects a non-Admin

## 19. Sync logs become Channel telemetry
**Blocked by:** 3, 4

**What to build:** Sync history is a fact about a Channel, visible to anyone who Follows it, so people
can see why they did or did not receive Posts.

- [ ] Sync logs carry no owner and are visible by Follow
- [ ] Search across sync history still works within that scope
- [ ] Both flag states are green

## 20. Split retention four ways
**Blocked by:** 3, 4, 6

**What to build:** Post retention is a deployment policy an Admin sets once. Log and report retention
stay personal. One person's settings can never delete another's evidence.

- [ ] Post, embedding, translation, and sync-state sweeps run on the single deployment policy
- [ ] Log sweeps run per User on that User's window
- [ ] Discovery report pruning is per-User, not across the whole table
- [ ] Channels with no Followers are collected
- [ ] Asset pruning stays global

## 21. Enable enforcement and prove isolation (integrate)
**Blocked by:** 15, 16, 17, 18, 19, 20

**What to build:** Two real accounts genuinely cannot see each other. This is the acceptance gate for
the whole tenancy programme.

- [ ] Owner columns are non-null with real cascading keys, added without exclusive locks on large tables
- [ ] An isolation test parametrised over the whole mounted route inventory passes for two accounts
- [ ] Another account's row returns not-found on read, update, and delete
- [ ] Deleting an account cascades its rows while shared Channels and Posts survive
- [ ] The single-operator helper and its null-owner fallback are deleted
- [ ] Two existing tests encoding single-operator behaviour are inverted, not deleted
- [ ] The suite is green with enforcement both off and on

## 22. Drop the superseded columns (contract)
**Blocked by:** 21

**What to build:** The corpus owner columns and the Channel columns that moved to the Follow are gone,
so nothing can drift back to using them.

- [ ] Owner columns are dropped from the corpus tables
- [ ] The migrated per-User columns are dropped from the Channel
- [ ] A guard asserts corpus models carry no owner and no module references one, stating the reason
- [ ] The guard has been watched to fail

## 23. Enqueue lane selection and the best-effort tier
**Blocked by:** 8, 12

**What to build:** A User over one Budget keeps working, more slowly, on that Budget only. Their other
two Budgets are unaffected, and they still receive Posts from Channels other people sync.

- [ ] Enqueue reads current usage and chooses the normal or best-effort lane
- [ ] Exhausting one Budget leaves the other two at normal priority
- [ ] Best-effort work runs only when normal work is idle
- [ ] A guard covers the ladder in both directions

## 24. Ceilings, Admin overrides, and the usage warning
**Blocked by:** 23

**What to build:** An Admin sets default and per-User Budgets and sees usage. A User sees their own
usage and a persistent warning when a Budget runs out.

- [ ] Defaults and per-User overrides exist for each of the three Budgets independently
- [ ] A Budget of zero means always best-effort, never blocked
- [ ] An absolute per-Budget ceiling stops work entirely, lifts at the daily reset, and can be lifted early
- [ ] A User sees per-Budget usage and a persistent warning when exhausted
- [ ] A guard asserts zero does not mean blocked

## 25. Open registration and approval
**Blocked by:** 7

**What to build:** People can sign up for themselves. An Admin can require approval, and an unapproved
person sees a clear explanation rather than errors.

- [ ] Registration creates a User with the default role
- [ ] Approval can be required by configuration, defaulting to off
- [ ] An unapproved person is refused with a clear reason and sees a dedicated page
- [ ] An Admin can approve, disable, and re-enable accounts

## 26. View as, read-only
**Blocked by:** 7, 21

**What to build:** An Owner can look at the app exactly as a given User sees it, to reproduce a
reported problem, without being able to change anything.

- [ ] An exchange returns a short-lived session naming both the target and the acting Owner
- [ ] Every write is refused during the session
- [ ] An unmissable ribbon names the account being viewed and survives a reload
- [ ] The session expires on its own
- [ ] Sessions are recorded with who, whom, and when
- [ ] Viewing as another holder of the permission is refused
- [ ] A deleted target produces a clear error and returns the Owner to their own account

## 27. View-as elevation and acted-by
**Blocked by:** 26

**What to build:** An Owner can elevate a session to make a change on someone's behalf, and the record
never claims that person asked for it.

- [ ] Elevation is explicit, separately recorded, and shorter-lived than the read-only session
- [ ] Elevation is refused when the target is an Admin
- [ ] Artifacts written during elevation record the acting Owner alongside the User
- [ ] The acting Owner is visible in that User's History
- [ ] A guard covers the refusal and the attribution

## 28. Admin-scoped export
**Blocked by:** 21

**What to build:** An Admin can export one User's data or everyone's, and an exported Summary still
cites Posts the export contains.

- [ ] Export is Admin-only and takes a subject
- [ ] It covers the subject's Follows, Artifacts, and settings
- [ ] It includes the Posts of Channels the subject Follows
- [ ] It streams, and reports the row count before starting
- [ ] Import routes Channel creation through the Follow path

## 29. Remove items
**Blocked by:** 21

**What to build:** The template's demo resource is removed. It was kept as the reference implementation
of owner-scoped access, and the tenancy seam has now replaced it.

- [ ] Its routes, models, relationship, and interface are removed
- [ ] Its table is dropped
- [ ] Its tests go, including one of the three known-failing browser specs
- [ ] Repository guidance no longer references it as the example

## 30. Per-account Discover dismissals
**Blocked by:** 3 — **blocks 21**

**What to build:** Dismissing a Discover candidate is your judgement, not everybody's.
`tg_discover_ignored` gains the owner half of its primary key so two accounts can dismiss and
un-dismiss the same handle independently.

Added after ticket 16, which scoped the Discover reads and found this one could not follow them.
The table is keyed by `handle` alone, so this is a migration — composite key, cascading foreign
key, backfilled owner — not a call-site change. Scoping only the read is worse than leaving it:
`ignore_channels` skips a handle that already has a row, so once one account dismisses a handle,
a second account's dismissal writes nothing and a scoped read tells them it is not dismissed.

- [ ] The table is keyed by `(handle, user_id)`, with a cascading foreign key and existing rows backfilled to an owner
- [ ] Dismissing, listing, and undoing all read and write the caller's own rows
- [ ] Two accounts can hold opposite verdicts on one handle, and neither can see the other's
- [ ] Both flag states are green

## 31. Scope the import path
**Blocked by:** 17

**What to build:** `POST /data/import` stops writing rows that belong to other accounts.

Found by review during ticket 17, whose own argument is that a scoped read over a writable row
is half a fix. That ticket closed it for the four artifact families' own endpoints and not for
import, which reaches the same tables by a different door — including bot credentials, which
carry tokens.

- [ ] Importing an id another account owns does not overwrite that row
- [ ] The decision about whether an Admin may import *for* another account is written down, not implied
- [ ] Bot credentials and chat destinations are covered, not just artifacts
- [ ] Both flag states are green

## 32. Scope credentials and chat destinations
**Blocked by:** 3 — **blocks 21**

**What to build:** Your bot credentials and chat destinations are yours. The two list endpoints
stop returning every account's rows.

Found by review during ticket 31, which closed the writes on these two families and left the
reads open. (This ticket claimed to be the last unscoped read family in `app/`; the review of its
implementation found that false — setting groups and `SyncJob` are still unaudited, so 21 must not
read it as an all-clear.) `tenancy.py` has classified both as `USER_OWNED`
since ticket 03; only the call sites never adopted it, so one family answers two different
questions about whose rows these are depending on the verb. The flip does not fix it — these
reads never call `scoped_select`, so enforcement changes nothing here.

- [ ] `list_bot_credentials` and `list_chat_destinations` read through `scoped_select`
- [ ] Both take a `user_id` with no default, so a caller cannot omit it
- [ ] A second account's credentials and destinations are absent from both lists
- [ ] Both flag states are green
