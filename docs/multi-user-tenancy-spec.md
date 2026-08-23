# Spec: Multi-user, quotas, and the sync queue

## Problem Statement

The summarizer is a single-operator tool. One bootstrap superuser owns every Channel, Post,
Summary, Chat, Tag run, and Discovery report in the database, and there is no way to give a second
person an account without handing them the first person's data. Anyone who logs in sees everything,
can change anyone's settings, and can delete a Channel along with every Post in it.

That blocks the actual need: several people want to use one deployment, each watching their own
Channels and keeping their own analysis private, without paying for the same Channel to be scraped
once per person.

There are also four live defects in the account flows that this exposes. Password reset is
unreachable on the deployed instance, because the auth middleware rejects the recovery routes before
the application sees them. When mail is unconfigured, which is the shipped default, requesting a
reset for a real address fails while requesting one for an unknown address succeeds, which tells an
attacker which addresses have accounts. There is no rate limiting on registration or login. And
logging out leaves the previous person's cached data and stored preferences in the browser.

## Solution

Every person gets an account. Channels and Posts become a shared corpus that any number of people can
Follow, so a Channel is scraped once and its Posts serve every follower. Everything a person produces
or configures becomes private to them: Artifacts, settings, credentials, publish destinations, and
the list of Channels they Follow.

Scraping is the scarce resource, so each User gets three daily Budgets of Requests: automatic sync,
manual bulk sync, and manual single sync. Within Budget, work runs at normal priority. Over Budget,
that one Budget's work drops to best-effort and runs when the scrapers are otherwise idle, while the
other two are unaffected. Nothing is refused until an absolute per-Budget ceiling. Because the corpus
is shared, a User whose own Budget is spent still receives new Posts whenever someone else syncs a
Channel they both Follow.

Roles become real. A User uses the app. An Admin administers the deployment: approving accounts,
setting Budgets and retention, exporting data, and reaching destructive operations. An Owner is an
Admin who can also View as another User, read-only by default, to reproduce a reported problem.

Underneath, the scheduler moves out of the web process into a worker that consumes a durable queue,
which is what makes the priority tiers possible at all.

## User Stories

### Accounts and access

1. As a person without an account, I want to register myself, so that I can use the deployment without an Admin provisioning me.
2. As a User who forgot my password, I want to request a reset link, so that I can regain access without contacting anyone.
3. As a User requesting a reset, I want the same response whether or not my address has an account, so that the endpoint cannot be used to discover who has accounts.
4. As an Admin, I want registration and login rate limited, so that an open deployment cannot be flooded.
5. As an Admin, I want an option requiring me to approve new accounts, so that I can gate an internet-facing deployment.
6. As an Admin, I want that approval requirement off by default, so that a self-hoster who enabled open registration gets what they asked for.
7. As a User awaiting approval, I want a clear page explaining my state, so that I am not shown a permission error on every action.
8. As a User, I want to log out and leave nothing behind on a shared browser, so that the next person sees none of my data, cached or stored.

### Owning my own work

9. As a User, I want my Follows to be private, so that other Users cannot see which Channels I watch.
10. As a User, I want my Channel list to show only Channels I Follow, so that my workspace reflects my own interests.
11. As a User, I want my Summaries, Chats, Tag runs, and Discovery reports visible only to me, so that my analysis stays private.
12. As a User, I want my History to list only my own Artifacts, so that it is a record of my work.
13. As a User, I want my settings to be mine alone, so that another User changing their language or model does not change mine.
14. As a User, I want my Scope selection to persist per account, so that logging in on a shared browser does not inherit someone else's selection.
15. As a User, I want my bot credentials and publish destinations private and encrypted at rest, so that nobody else can publish as me.
16. As a User, I want to see the sync history of Channels I Follow, so that I can tell why I did or did not receive Posts.
17. As a User, I want my account deletion to remove my Artifacts, Follows, and settings, so that nothing of mine is orphaned.

### Sharing the corpus

18. As a User, I want to Follow a Channel someone else already Follows, so that I receive its Posts immediately rather than waiting for a fresh scrape.
19. As a User, I want a Channel's full Post history available when I Follow it, so that I can summarize periods before I joined.
20. As a User, I want to unfollow a Channel, so that it leaves my list without destroying Posts other Users depend on.
21. As a User, I want to receive new Posts from Channels other people sync, so that I benefit from shared activity without spending my own Budget.
22. As a User, I want a sync request for a Channel already being synced to return that result, so that I do not wait for redundant work.
23. As an Admin, I want Channels nobody Follows removed by retention, so that abandoned Channels do not accumulate.

### Budgets

24. As a User, I want to see how many Requests I have used against each Budget today, so that I can pace my work.
25. As a User, I want a persistent warning when a Budget is exhausted, so that I understand why my syncs became slow.
26. As a User, I want my work to continue at low priority after exhausting a Budget, so that I am degraded rather than blocked.
27. As a User, I want exhausting one Budget to leave the other two untouched, so that I can still check a single Channel by hand.
28. As a User, I want Budgets to reset daily, so that one bad configuration does not cost me a month.
29. As a User, I want failed syncs charged only when Telegram was actually reached, so that proxy and network faults are not billed to me.
30. As a User, I want retries not charged, so that an unreliable proxy does not consume my Budget.
31. As an Admin, I want to set default Budgets for all Users, so that I can bound the deployment's scraping load.
32. As an Admin, I want to override each Budget for a specific User, higher or lower, so that I can accommodate different needs.
33. As an Admin, I want a Budget of zero to mean always best-effort rather than blocked, so that a deprioritized User still gets service when there is spare capacity.
34. As an Admin, I want an absolute ceiling per Budget, so that a runaway configuration eventually stops entirely.
35. As an Admin, I want ceilings to lift automatically at the daily reset, so that a block is never permanent by accident.
36. As an Admin, I want to lift a ceiling early, so that I can unblock someone mid-day.
37. As an Admin, I want to see each User's usage, so that I set limits from evidence rather than guesswork.
38. As an Admin, I want usage history kept indefinitely, so that I can see trends over months.

### Administration

39. As an Admin, I want to list, edit, approve, and disable accounts, so that I can administer the deployment.
40. As an Admin, I want retention for Posts set once for the deployment, so that one User's policy cannot delete another User's evidence.
41. As an Admin, I want log and report retention to remain per-User, so that people control their own clutter.
42. As an Admin, I want to export data for one User or for all Users, so that I can back up or migrate.
43. As an Admin, I want an export to include the Posts of Channels its subject Follows, so that exported Summaries still cite something.
44. As an Admin, I want destructive database operations restricted to Admins, so that a new signup cannot clear tables.
45. As an Admin, I want network logs and scheduled job records visible only to Admins, so that infrastructure telemetry is not noise for Users.

### View as

46. As an Owner, I want to View as any User, so that I can reproduce a problem they reported.
47. As an Owner, I want View as read-only by default, so that I cannot accidentally alter someone's data while looking.
48. As an Owner, I want to elevate a session to read-write when I genuinely need to fix something, so that I can act on their behalf.
49. As an Owner, I want elevation refused when the target is an Admin, so that the permission cannot silently become Admin.
50. As an Owner, I want to be unable to View as another holder of the same permission, so that peer accounts stay protected.
51. As an Owner, I want an unmissable ribbon naming the account I am viewing, so that I never mistake it for my own.
52. As an Owner, I want that ribbon to survive a page reload, so that I cannot lose track mid-session.
53. As an Owner, I want sessions to expire on their own, so that a forgotten one does not stay open.
54. As an Owner, I want every session recorded with who, whom, and when, so that there is an answer to who looked at what.
55. As a User, I want Artifacts created during an elevated session to name the Owner alongside me, so that my History does not claim I asked for something I did not.
56. As an Owner, I want a clear error and a return to my own account if the User is deleted mid-session, so that I am not stranded at a login screen.
57. As an Admin, I want the View-as permission grantable to a new role without code changes, so that adding a read-only auditor is data rather than a migration.

### Scraping and the queue

58. As an Admin, I want the scheduler to run outside the web process, so that API restarts and deploys do not disturb syncing.
59. As an Admin, I want each Channel sync to be its own queue message, so that one failing Channel cannot fail a batch of two hundred.
60. As a User, I want a bulk sync still reported as one job with progress, so that I see "12 of 50" rather than fifty unrelated events.
61. As an Admin, I want normal-priority work always drained before best-effort, so that the tier distinction means something.
62. As an Admin, I want automatic sync never starved by a steady trickle of manual work, so that the product does not quietly stop doing its job.
63. As an Admin, I want queue messages interleaved across Users, so that one person following five hundred Channels does not block everyone behind them.
64. As an Admin, I want a Channel whose worker crashed to be picked up again, so that work is never silently lost.
65. As an Admin, I want concurrent syncs of the same Channel prevented, so that its history cursors are not corrupted by interleaved writes.
66. As an Admin, I want each worker bound to one proxy with a long-lived connection, so that connection reuse is maximized and the per-proxy rate is predictable.
67. As an Admin, I want worker count derived from proxy count, so that the one-worker-one-proxy relationship holds by construction.
68. As an Admin, I want a worker whose proxy is in cooldown to park, so that capacity honestly reflects available proxies.
69. As an Admin, I want the scraper to widen its wait adaptively per proxy after rejections and narrow it again on sustained success, so that we avoid rate limiting without permanently slowing down.
70. As an Admin, I want to pause or drain one queue lane, so that I can manage load without stopping everything.

## Implementation Decisions

### Data model

- **The corpus is already shared and needs no de-duplication.** Channels are keyed by handle, Posts
  are unique per Channel and Post id, and embeddings and translations are keyed the same way. The
  existing owner column on these tables is a "who created this first" stamp, not ownership, and is
  removed. Corpus comprises Channels, Posts, post sync state, embeddings, translations, handle
  probes, and sync metadata.
- **A new Follow table** carries the relation between a User and a Channel, with a composite natural
  primary key of the two, and real foreign keys cascading on delete from both sides. It holds the
  per-User settings that currently sit on the Channel row: setting group, followed-at, tags, start
  id, start time, discovery provenance, and the Follow's own next sync time.
- **The Channel row keeps only corpus facts**: display name, bio, subscriber count, media counts,
  chat id, language, last updated, the sync deadlines and claim, and the history cursors.
- **Setting groups need no redesign.** They are already per-User by an id convention with a unique
  index; they gain a foreign key.
- **Eighteen per-User tables gain a real foreign key** to the user table, cascading on delete:
  Artifacts and their payloads, ignored Channels, credentials, destinations, setting groups, sync
  jobs, and the log tables. Foreign keys are added with a not-valid constraint then validated, so
  large tables are not locked exclusively for the duration.
- **Settings split into two tables.** One holds deployment-global settings keyed by name; the other
  holds per-User settings keyed by name and User. Different things with different access control, so
  a separate table makes it a schema fact rather than a convention. The scheduler runtime state
  currently mixed into the sync settings moves to the global table.
- **Sync logs become Channel telemetry** with no owner, visible to anyone who Follows the Channel.
  Network logs and scheduled job rows keep a nullable owner and are Admin-only.
- **There is no system User.** An earlier design used a reserved owner id for scheduler-written rows,
  which contradicts the not-null foreign keys; the three decisions above remove the need entirely.
- **The four Artifact tables gain an acted-by column**, recording an Owner who wrote the row during
  an elevated View-as session.
- **A usage ledger** records one row per User, per day, per Budget, holding a Request count. It is
  never pruned.

### Roles and permissions

- Permission constants live in code; roles and role assignments live in data, seeded with User,
  Admin, and Owner. Call sites check a permission constant, never a role name, so adding a role is an
  insert rather than a migration. No permission-editing interface is built.
- View as is a permission, not a role. Owner holds it by default.
- Approval is a new flag on the user record, distinct from the existing active flag, because
  "never approved" and "disabled by an Admin" are different states and the admin screen needs both.

### Access control

- A single tenancy module provides a scoped select, an ownership assertion, and the model
  classification. It is a pure transform: it builds queries and compares identifiers, and executes
  nothing. This is deliberate, because the existing service-kind guard then mechanically prevents it
  from growing database access later.
- Scoping dispatches on model class. Per-User models filter on owner. Follow-scoped corpus models
  filter by an existence check against the Follow table, never on the owner column, since those
  columns are being dropped. Handle probes and sync metadata are unscoped, deliberately and with the
  reason recorded.
- Ownership violations return not-found rather than forbidden, so the API does not confirm the
  existence of another User's rows.
- The current single-operator helper module is deleted, along with its predicate that treats a null
  owner as belonging to the operator and its local-environment fallback that returns all rows. Both
  existed to tolerate stale data and would leak rows across Users.
- A feature flag gates enforcement and is read in exactly one function, so the whole change can ship
  green and be enabled as a separate deploy. With it off, generated queries are identical to today's.
- Roughly ninety route handlers currently receive the authenticated User and discard it by naming
  convention. Each is converted to use it. The convention is enforced by extending the existing route
  hygiene test so a discarded identity requires a declared reason.
- The administrative routes covering database statistics, table sizes, table clearing, and import
  become Admin-only. They are currently available to any authenticated User.

### Deleting Channels

Deleting a Channel currently removes the Channel row and bulk-deletes every Post belonging to it,
with no ownership check. That becomes unfollowing. There is no user-facing hard delete and no Admin
purge; Channels nobody Follows are collected by the retention job.

### Retention

The retention job splits four ways. Per-User log sweeps run per User on that User's window. The Post
sweep runs on the Admin's single deployment policy. Discovery report pruning becomes per-User; it
currently orders across the whole table, so one User's reports would delete another's. Asset pruning
for cached avatars and thumbnails stays global.

### Quotas

- The unit is one HTTP Request to Telegram, excluding retries. Sync depth varies from a single
  request to dozens, so counting syncs rather than requests would make a limit meaningless as a load
  control.
- Three Budgets share a daily reset at midnight UTC, with independent defaults and independent
  per-User overrides. A single multiplier cannot express a throttled automatic Budget alongside a
  generous manual one, which is the case that motivated splitting them.
- Enforcement happens at enqueue, which reads current usage to choose a lane. Accounting happens at
  completion, which charges the Requests actually made. The network layer cannot do the accounting
  because it does not know which User a request serves.
- A Budget at zero means always best-effort, never blocked. The ceiling is therefore an absolute
  number per Budget rather than a multiple of the Budget.
- Requests that reached Telegram are charged even when the response is an error. Proxy and network
  failures are not charged.

### Queue and workers

- The queue is PGMQ, installed by its pure-SQL script run from a migration so it joins the existing
  version chain rather than forking the migration story, and so the stock Postgres image is unchanged
  and no superuser privilege is needed.
- PGMQ has no priority queue, so priority is expressed as separate queues. Six exist: automatic,
  manual bulk, and manual single, each in a normal and a best-effort variant. This also makes each
  backlog separately inspectable, drainable, and pausable.
- The existing handle-probe queue is left alone. Its cache row and its work item are deliberately the
  same row, and splitting them to match the new queue would create the disagreement its design
  prevents, in exchange for cosmetic uniformity and no Budget tiering.
- Draining is strict between tiers and weighted within one, favouring manual single, then manual
  bulk, then automatic. Strict priority within a tier would let a trickle of manual work starve
  automatic sync.
- One message per Channel sync, never one per scheduler tick. The batch abstraction stays on the
  existing job row and its progress stream, so a fifty-Channel bulk sync is one job and fifty
  messages carrying its id.
- Messages are enqueued interleaved across Users, since the queue is first-in-first-out within a lane.
- Visibility timeouts are set per queue at roughly twice the expected worst case, generous on the bulk
  lane, because a sync outlasting its timeout would be redelivered, double-scraped, and double-charged.
  Redelivery is capped and exhausted messages are archived rather than looping.
- The scheduling deadline and the in-flight claim are separate fields. The deadline means only "when
  this should next run" and advances on completion; the claim marks in-flight and expires on its own.
  Advancing the deadline at enqueue would conflate enqueued with synced and would strand a Channel
  silently once its message was archived.
- Per-Channel mutual exclusion is required for correctness, not efficiency: concurrent syncs interleave
  writes to the Channel's last-updated, anchor, oldest-stored, and history-complete cursors. This is
  currently protected by an in-memory lock that does not survive moving the scheduler out of the web
  process.
- A sync request finding one already in flight for that Channel waits for it and reports its result,
  and is not charged, because no Requests were made on its behalf.
- The sync tier remains a single replica. The binding constraint is politeness to Telegram through a
  fixed proxy set, not processing capacity.
- Each worker owns one proxy and holds a long-lived connection to it. This replaces the shared
  per-proxy semaphore with partitioning, which removes one of the three reasons the process count is
  pinned. Worker count is derived from proxy count.
- Adaptive wait state is held per proxy: multiplicative increase on explicit rejection or soft block,
  gentle linear decay on sustained success, with latency drift as a weak signal. The existing backoff
  is per-request and resets on every call, which is the gap this closes.

### Client and browser

- The wire shape of the Channel payload does not change. The API already flattens setting-group fields
  onto the Channel, so the read path joins Follows instead of the owner column and the generated
  client and its conformance checks stay valid.
- Browser storage is namespaced per User through the existing reader and writer interfaces in the
  settings store, using the subject claim decoded from the token client-side without verification.
  The identifier is needed synchronously at first render, before the current-User query resolves, and
  a forged token yields a namespace rather than data. This also avoids adding a field to the workspace
  context, keeping its pinned invariant honestly true rather than edited around.
- The access token and the theme preference stay unnamespaced, declared as device-scoped with the
  reason recorded.
- Providers remount on a change of User so no in-memory state crosses accounts. Logging out clears
  the query cache.
- The View-as ribbon is driven by a claim in the token, so it survives a reload without extra state.

### Auth flow fixes

- The password recovery and reset routes are added to the middleware's public paths. They are declared
  without the login prefix that the exemption matches, so they are currently unreachable for a
  logged-out browser in staging and production.
- The recovery endpoint checks whether mail is configured before sending, so it returns its uniform
  response instead of failing for known addresses and succeeding for unknown ones.
- The API key comparison becomes constant-time.
- Rate limiting is added at the edge proxy on the registration and login paths, alongside the existing
  compression middleware.

## Testing Decisions

**What makes a good test here.** Assert external behaviour: the response a User receives, the rows
that exist afterwards, the messages that were enqueued. Do not assert that a particular function was
called or that a query has a particular shape. The exception is the existing family of structural
guards, which deliberately assert source-level facts because they encode invariants no runtime test
can observe; each of those states its reason in prose, and new ones follow that form. Every new guard
is mutation-tested, meaning the assertion is watched to fail against a deliberately broken
implementation before it is trusted. This project has caught six false-passing guards that way,
including one that could not fail at all.

**Two seams.**

1. **The existing HTTP boundary.** The API test suite already drives the whole application through a
   test client, and there is already a helper that mints authenticated Users. This carries nearly
   everything: cross-User isolation, Budget tiering, role checks, View as, unfollow semantics, and
   the auth flow fixes. Cross-User isolation is parametrised over the existing route inventory rather
   than a hand-written list of endpoints, so a reader that was missed fails by construction instead of
   by someone remembering it.
2. **One new seam at the queue consumer's claim-and-process entry point.** This is the only new seam,
   and it exists because a background consumer has no synchronous response to assert against. It
   covers claiming, coalescing, redelivery after a crash, and per-Channel mutual exclusion.

**Two existing lower seams are kept, not replaced.** The service test suite covers the pure transforms,
and the frontend architecture invariant tests cover the source-level facts: which modules may touch
browser storage, and that logging out clears the query cache.

**Modules tested.** Tenancy scoping, the Follow aggregate, the quota ledger and lane selection, the
retention split, the settings table split, role and permission checks, View-as limits and audit, and
the queue consumer.

**Prior art to follow.** The route inventory test for enumerating mounted routes; the route hygiene
test for asserting declared exceptions with reasons; the service-kind inventory for classifying a new
module and mechanically preventing a pure transform from acquiring database access; the payload cost
tests for asserting both that an expensive path is avoided and that the path which should still use it
does; and the worker count test for asserting not just a number but each reason behind it.

**Two existing tests assert the current single-operator behaviour and must be inverted rather than
deleted.** One requires that automatic sync skips another User's Channel; the other exercises the null
fallback that this work removes.

**Both flag states must pass.** The suite runs with enforcement off and on, because a change that is
only green with the flag enabled is not revertable.

## Out of Scope

- **Most-eager-wins scheduling and shared-cost attribution.** Each User's request syncs the Channel;
  others benefit because the Posts land in a shared corpus. Deferred with it: aggregating followers'
  schedules, per-follower service tracking, and splitting cheap polling from expensive backfill so one
  User's deep history request cannot stall the shared poll. The Follow row carries its own next-sync
  field from the start, because that is the column the deferred design needs and adding it later means
  migrating a large table.
- **No trigger metric for the above.** Revisit when user numbers make the optimization worth its
  complexity.
- **Multiple sync replicas.** The queue makes it possible; the proxy budget makes it pointless for now.
- **Social login, invitations, and refresh tokens.** None exist upstream and none are added.
- **Self-service export.** Export is Admin-only, for themselves or all Users.
- **An Admin hard delete for Channels.** Unfollow is the only removal; retention collects the remainder.
- **Cross-User Channel discovery**, such as suggesting Channels other people Follow. Follows are
  private; this would be an explicit opt-in feature later.
- **A permission-editing interface.** Roles are data, so a fourth role is an insert, but no editor is
  built.
- **Migrating the handle-probe queue** to the new queue technology.
- **Per-User retention for Posts.** It is deployment policy, because on a shared corpus a per-User
  window mostly cannot do what its label says.

## Further Notes

- **This spec covers both programmes end to end and is too large for a single execution pass.** The
  intended order is: the auth flow fixes, then the schema and backfill, then the queue and worker
  split, then read scoping, then registration and roles. The auth fixes are independent of everything
  else and one of them fixes a flow that is broken in production today. The queue lands before read
  scoping because Budget deprioritization cannot be implemented without it, and because doing scoping
  first would rewrite the scheduler twice.
- **A locked decision is being reversed.** The migration decision record specifies open registration
  disabled in production with a single superuser owning all data. That record, the auth architecture
  decision record, the repository guidance file, and the development and deployment guides must be
  updated in the same change, or the prose will describe the opposite of the code.
- **The glossary needs updating first.** The domain glossary defines a Channel as one the operator
  follows and uses "operator" as the actor throughout without defining it. The terms User, Admin,
  Owner, Follow, View as, Budget, and Request are added; Channel and Scope are reworded; "operator" is
  retired everywhere.
- **Continuous integration is billing-blocked and runs nothing on a pull request.** All verification is
  local, including a migration rehearsal against a restored copy of production data, because
  migrations run unattended on every boot.
- **Detailed design, file paths, migration ordering, and the full guard list** live in the companion
  planning document in the repository docs directory.
