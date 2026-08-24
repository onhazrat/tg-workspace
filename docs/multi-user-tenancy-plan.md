# Multi-user, quotas, and the sync queue

Two programmes, designed together in one grilling session, sequenced to interleave.
**A: multi-tenancy.** **B: the sync queue and worker split.**

## Context

The app runs in **Mode A** today: one bootstrap superuser owns everything
(`docs/migration/DECISIONS.md` #1, `ADR-002-auth.md`). Nullable `user_id` columns were added to every
TG table in June 2026 as forward-compatible metadata, and `items` was kept out of the simplification
programme as the reference implementation of owner-scoped access. We are now using that hatch.

The goal is multi-tenancy where **the corpus is shared and the outputs are private**. Two findings
from reading the code frame everything below.

**The corpus is already physically shared.** `Channel.id` is a plain string PK, `Post` carries
`UniqueConstraint(channel_name, post_id)`, and `PostEmbedding.id` / `PostTranslation.id` are globally
unique with `user_id` never populated at any write site. The schema *cannot* hold two users' copies of
a channel, post, embedding, or translation. `user_id` on those tables was never ownership; it is a
"who created this row first" stamp. There is no de-duplication work to do.

**But the read path is not operator-scoped today at all.** `services/channels.py:311` is a bare
`select(Channel)`; so are the bios, stats, posts, discover, RAG, artifacts, and export readers. The
operator predicate exists only in the scheduler, `stats.py`, `retention.py`, and `auto_summary.py`.
Replacing `operator.py` is roughly 15% of the scoping work; the rest is ~40 call sites that have
never had an owner filter of any kind.

## Prior art: the upstream template

Cloned and diffed. `routes/login.py`, `models.py`, `crud.py`, and `core/security.py` are
**byte-identical** to ours; only `users.py` differs, by our `USERS_OPEN_REGISTRATION` gate which
upstream lacks. Across its `backend/app` + `frontend/src`: zero invites, zero refresh tokens, zero
social login, zero tenancy, and `is_superuser` as the only role. The two `oauth` hits are
`OAuth2PasswordBearer`/`OAuth2PasswordRequestForm`; the one `social` hit is footer links.
Register and forgot-password exist and are already fully vendored here. **The account layer is done.**

---

# Glossary changes (`CONTEXT.md`)

`CONTEXT.md:13` currently defines **Channel** as *"A public Telegram channel the operator follows"*,
which is single-operator by construction, and uses "operator" as the actor throughout while never
defining it. Apply these deltas in the first implementation commit.

**Retire "operator" entirely**, including in `deployment.md`, `development.md`, and `CLAUDE.md`.

| Term | Definition |
|---|---|
| **User** | A person with an account. Owns their Artifacts, Follows, and settings. |
| **Admin** | A User who administers the deployment: approves accounts, sets quotas and retention, exports data. |
| **Owner** | The top authority. Everything an Admin can do, plus **View as**. |
| **Follow** | The relation between a User and a Channel. Carries that User's per-channel settings. _Avoid_: subscription, watch. |
| **View as** | Reading the app through another User's account. Read-only by default, audited, time-boxed. _Avoid_: impersonate, sudo, masquerade. |
| **Budget** | A daily allowance of scrape Requests, in one of three kinds: auto sync, manual bulk, manual single. |
| **Request** | One HTTP call to `t.me`. The unit every Budget is counted in. |

**Channel**, reworded: *"A public Telegram channel. Users Follow Channels; the Channel and its Posts
are shared by every follower."*

**Scope**, reworded: unchanged in structure (Channels × date range × filters), with *"drawn from the
Channels you Follow"* added. It keeps naming Channels, not permissions, so a frozen Scope still
resolves when reopened after the follow list has changed.

---

# Decisions

## Tenancy

1. **Corpus** (`tg_channels`, `tg_posts`, `tg_post_sync_state`, `tg_post_embeddings`,
   `tg_post_translations`, `tg_discover_probes`, `tg_sync_meta`) is user-agnostic.
   **Per-user** are the 18 tables covering Artifacts, credentials, destinations, settings, setting
   groups, sync jobs, and logs.
2. **New follower sees full history.** Nothing filters reads by follow date. It is the honest
   consequence of a shared corpus and costs no new code.
3. **Follows are private.** `GET /data/channels` is scoped to your own follows. "Which channels am I
   watching" is the most sensitive thing here, and a shared catalog leaks it to every signup.
   Cross-user Discover suggestions stay an explicit opt-in for later.
4. **Retention is deployment policy.** `postRetentionDays` deletes corpus, so an Admin sets it and it
   applies uniformly. Per-user retention on a shared corpus is a setting that does not do what its
   label says. Log and report retention stay per-user, where they genuinely are.
5. **Delete becomes Unfollow, for everyone.** No user-facing hard delete and no Admin purge.
   Zero-follower channels are collected by retention. The current `delete_channel` bulk-deletes every
   `Post` of the channel with no owner check (`channels.py:396`) and is the one data-loss bug here.
6. **Export is Admin-only**, for themselves or for all users, and includes the posts of channels the
   subject follows. A regular User has no self-export; noted as a choice, not an oversight.
7. **Approval defaults off.** `USERS_REQUIRE_APPROVAL=False` shipped; turn it on for this deployment
   while it is internet-facing.

## Roles

8. **Proper RBAC**: permission constants in code, a `role` table, a `user_role` join, seeded with
   **User**, **Admin**, **Owner**. Call sites check a *permission constant*, never a role name, so a
   fourth role is an INSERT rather than a migration. No permission-editor UI now.
   **Done** (ticket 07): tables are `rbac_roles` / `rbac_user_roles` in a third model module,
   `app/models_rbac.py`. Two things the plan did not anticipate. The permission set lives as a JSON
   column *on the role row* rather than in a third join table, which is what makes "a fourth role is
   an INSERT" literally one statement. And migration seeds drift from code constants the moment
   someone adds a permission — the row still holds yesterday's list, and the row is what
   authorisation reads — so `reconcile_seeded_roles` runs on every boot, touching only the three
   seeded ids.
9. **`impersonate` is a permission**, not a role. Owner holds it by default.
10. **View as** is read-only by default and can be elevated to read-write when genuinely needed.
    Nobody may View as a holder of the `impersonate` permission. Elevation is refused when the target
    is an Admin, so the grant cannot silently become Admin.
11. **Carried by token exchange**: `POST /login/impersonate/{user_id}` returns a short-lived JWT with
    `sub` = target and an `act` claim naming the Owner. The ribbon is a function of the token, so it
    survives reload; the 30-minute limit is the token's `exp`; `deps.get_current_user` is the one
    place that resolves both identities and enforces read-only. The client must **keep** the original
    token, not overwrite it.
12. **Audit** is a dedicated table: who, whom, start, end. Not per-route logging, which produces
    volume nobody reads.
13. **`acted_by`** is added to the four Artifact tables only. `CONTEXT.md` calls the "deliberately
    asked for" clause load-bearing, so a row written during elevation must not claim the target
    asked for it. Settings and follows are covered by the audit table.
14. **Target deleted mid-session** → 403 with an explicit message; the client drops the impersonation
    token and restores the Owner's own.

## Quota

15. **Unit is one HTTP Request to `t.me`, excluding retries.** Sync depth varies from one request to
    fifty, so counting channel-syncs would make the limit meaningless as a load control. A flaky
    proxy is not the User's doing; `NetworkLog.attempts` already distinguishes.
16. **Three Budgets** — auto sync, manual bulk, manual single — sharing a **daily reset at UTC
    midnight**, with independent defaults and independent per-user Admin overrides. A multiplier
    cannot express the case that motivated the split: throttled auto sync alongside generous manual.
17. **The ladder**: within Budget → normal priority. Over Budget → best-effort on *that* Budget only,
    running when the scheduler and proxies are idle. Nothing is refused until the ceiling.
18. **Ceiling** is an absolute daily number per Budget, not a multiple, defaulting to ten times the
    default Budget. A multiple breaks against a zero Budget, which must mean "always best-effort"
    rather than "blocked". Auto-lifts at the daily reset; an Admin can lift early.
19. **Enforce at enqueue, account at completion.** Enqueue reads current usage to pick the lane;
    completion charges the actual Request count. Ledger `tg_quota_usage`, PK `(user_id, day, budget)`,
    **kept forever** — a few hundred rows a year, and it is what an Admin reads to set limits.
20. **Failed syncs are charged** when the Request reached Telegram and came back, error responses
    included; **not charged** for proxy or network failures. Same line as #15, and it removes the
    incentive that would make failing channels effectively unlimited.

## Ownerless rows: the System user dissolves

21. **Settings split into two tables**: `tg_app_settings` stays global with PK `key`, Admin-gated;
    a new `tg_user_settings` holds per-user with PK `(key, user_id)`. Different things, different
    access control, so a separate table makes it a schema fact rather than a convention.
    `jobs`, `retention`, and `sync_runtime` are global; the per-user half of `sync` moves across.
22. **`SyncLog` is channel telemetry**: drop `user_id`; visibility follows "do you follow this
    channel". A nullable owner meaning "scheduled" resurrects the exact ambiguity `operator.py` had
    and fails open on a forgotten stamp.
23. **`NetworkLog` and scheduled `SyncJob` are Admin-only**, keeping a nullable `user_id` for whoever
    triggered them. A nullable owner that leaks only to an Admin is an acceptable failure mode.
24. **Consequence: no System user, no nil UUID, no `is_system` flag.** My earlier design had a nil
    `SYSTEM_USER_ID` *and* `NOT NULL` FKs to `user.id`, which contradict. Dissolving the concept
    removes the contradiction rather than excepting it.

## The queue (Programme B)

25. **PGMQ**, installed by its **pure-SQL script run from an Alembic migration**. Keeps `postgres:18`
    stock, needs no superuser, and puts PGMQ inside the existing version chain. PGMQ supports PG
    14–18. ([pgmq/pgmq](https://github.com/pgmq/pgmq))
26. **PGMQ has no priority queue.** Priority is emulated with separate queues per lane, which also
    makes each backlog separately inspectable, drainable, and pausable.
27. **Six queues**: `{auto_sync, manual_bulk, manual_single} × {normal, best_effort}`.
28. **The probe queue stays as it is.** `tg_discover_probes` documents why the cache and the queue
    are deliberately one row; splitting them creates the disagreement that docstring warns about, for
    cosmetic uniformity and no quota tiering benefit.
29. **Drain order**: strict between tiers (all normal before any best-effort), weighted 3:2:1 within
    a tier favouring single, bulk, auto. Strict priority within a tier would let a trickle of manual
    work starve auto sync, which is the failure mode where the product quietly stops working while
    the worker looks busy.
30. **One message per channel-sync**, never per tick. Attribution, bounded visibility timeout,
    parallelism, and failure isolation all require it. The batch abstraction moves to the job row:
    `tg_sync_jobs` plus its SSE stream stays the batch view, so 50 channels is one job row and 50
    messages carrying its id.
31. **Enqueue interleaved by user**, round-robin rather than iterating one user's channels in bulk.
    PGMQ is FIFO within a queue, so a user following 500 channels would otherwise block everyone
    behind them; the Q42 weighting is between lanes and does nothing here.
32. **Visibility timeout ≈ 2× worst case per queue**, generous on the bulk lane. Cap redelivery with
    `read_ct` and archive beyond it rather than looping. Archive on success too, pruned on the log
    schedule. A bulk sync exceeding its VT would silently double-scrape and double-charge.
33. **Claim is separate from deadline.** `next_sync_at` keeps meaning only "when it should next run",
    advanced solely on completion; a new `sync_claimed_at` with its own expiry marks in-flight. On
    failure the worker clears the claim and applies the existing `apply_failure_backoff`
    (`sync_schedule.py:142`). Advancing the deadline at enqueue would conflate "enqueued" with
    "synced" and strands a channel silently once a message exceeds `read_ct` and is archived.
34. **Per-channel mutual exclusion cannot be deferred.** Concurrent syncs of one channel interleave
    writes to `last_updated`, `anchor_post_id`, `oldest_stored_post_timestamp`, and
    `history_complete_to_cutoff`. Posts are safe (`bulk_upsert_posts_impl` upserts on the unique
    constraint); those cursors are not. Today `scraper_jobs._channel_locks` protects them with an
    in-memory `asyncio.Lock` that vanishes when the scheduler leaves the web process.
35. **Coalescing**: a sync request finding one already in flight for that channel waits for it and
    reports its result, and is not charged, since no Requests were made on its behalf. Cheaper than
    a second round-trip that discovers nothing new, and honest about why it returned instantly.

## Workers

36. **One sync replica for now.** The binding constraint is politeness to `t.me` through a fixed
    proxy set, not CPU. The queue's value here is priority and durability, not parallelism.
    `tests/deployment/test_worker_count.py` is **updated** to guard the reasons that remain, not
    deleted — two of its three go away.
37. **One worker owns one proxy**, holding a long-lived connection. This deletes `proxy_pool` from
    the list of things blocking multiple workers: partitioning replaces the shared semaphore.
    Worker count is derived from proxy count so the invariant is true by construction, and a dead
    proxy parks its worker until cooldown expires.
38. **`DynamicWaitTime`**, per proxy: multiplicative increase on 429 or soft-block, gentle linear
    decay on sustained success, latency creep included but weighted well below explicit rejections.
    Today `network.py:284` backs off exponentially with a 10s floor on 429 and keeps a `_bad_proxies`
    cooldown map, but it is **per-request and stateless across calls** — it resets every time. That
    is the gap this fills.

## Deferred until there are many users on shared channels

39. **Most-eager-wins scheduling and shared-cost attribution.** For now each User's sync request
    syncs the channel; others still benefit, because the posts land in a shared corpus. Deferred:
    the effective-schedule aggregation, per-follower due calculation and `last_served_at`, and the
    poll-versus-backfill split that stops one User's deep backfill from stalling the shared poll.
    Retained now: `ChannelFollow.next_sync_at` from day one, because it is the column the deferred
    design needs and adding it later means a migration on a large table.
40. **No trigger metric built.** Revisit when user count makes the optimization worth its complexity.
    Note in `docs/scaling-to-multiple-workers.md` that this contradicts its own "iterate channels,
    not users" advice **deliberately**, so a future reader does not think it was overlooked.

---

# Sequencing

`jobs/auto_sync.py` is rewritten by both programmes, so the order matters.

| Step | What | Why here |
|---|---|---|
| **A0** | Auth-flow bug fixes | Independent of everything; fixes a broken forgot-password flow |
| **A1** | Schema: follows, settings split, RBAC tables, ledger; backfill + audit scripts | Touches no scheduler |
| **B1** | PGMQ install, six queues, claim + coalescing, worker/proxy split, `DynamicWaitTime` | Quota deprioritization is unimplementable without it |
| **A2** | Scoped reads, `tenancy.py`, FKs, unfollow/collect split | Rewrites a scheduler already in the right process |
| **A3** | Registration, quotas, roles, View as, `items` deletion | Depends on all of the above |

Doing A2 before B1 would rewrite `auto_sync.py` for follows and then immediately again to move it.
Doing B1 first would build a priority column before there is a notion of whose priority it is.

**Programme A** lives in `docs/multi-user-tenancy-plan.md`. **Programme B** extends the existing
`docs/scaling-to-multiple-workers.md`, which already carries the four-step sequence and the
worker-count reasoning. Each gets a short sequencing section pointing at the other.

## A0 — auth-flow fixes

**Done**, except item 4, which is ticket 02. Guards:
`backend/tests/api/test_public_route_exemptions.py`,
`test_auth_middleware.py`, `test_password_recovery.py`,
`backend/tests/deployment/test_edge_rate_limit.py`.

One correction to item 1 below, found while fixing it: staging builds the
frontend with `VITE_API_KEY=${API_KEY}` (`deploy-staging.yml:78`) and the
generated client sends it on every request, so recovery *was* reachable there —
on a secret embedded in a public JavaScript bundle. The fix stands, since a
logged-out flow must not depend on a build-time key, but the second auth gate is
weaker than `CLAUDE.md` claims wherever that variable is set. Worth its own
ticket.

Four pre-existing bugs, all verified in code:

1. **Forgot-password is unreachable in staging/production.** `middleware/api_key.py:66` exempts
   `/api/v1/login*`, but `login.py:53,77` declare `/password-recovery/{email}` and `/reset-password/`
   on a prefix-less router mounted at `/api/v1`. A logged-out browser has neither JWT nor API key
   (`VITE_API_KEY` is build-time, "not browser JWT auth" per `.env.example:290`), so the middleware
   401s first. Fix: add both to `_BASE_PUBLIC_PATHS`.
2. **`/password-recovery/` 500s without SMTP, defeating its own enumeration hardening.** `login.py:65`
   calls `send_email` unconditionally; `utils.py:39` opens `assert settings.emails_enabled`;
   `.env.example:94` ships `SMTP_HOST=` empty. Unknown email → 200, real email → 500: an account
   oracle. Fix: gate on `settings.emails_enabled`.
3. **No inbound rate limiting anywhere.** Add a Traefik `ratelimit` on signup and login, chained onto
   the existing `-backend-https.middlewares=` label (copy the `compress` pattern, `compose.yml:197`).
4. **`logout()` leaks the session** (`useAuth.ts:59`): removes the token, never calls
   `queryClient.clear()`. Upstream has the identical bug. Note `api/base.ts::clearStaleSession` is
   safe *by accident* via a hard `window.location.href`; don't soften it without adding the clear.

Also: `hmac.compare_digest` for the API key comparison.

## A1 — schema

`tg_channel_follows`: composite natural PK `(user_id, channel_id)`, real FKs both sides
`ON DELETE CASCADE`, plus `ix_..._channel_id` for the fan-out direction the PK's leading column
cannot serve. Carries `setting_group_id`, `followed_at`, `tags`, `start_id`, `start_time`,
`discovered_via`, `next_sync_at`.

**`ChannelSettingGroup` needs no redesign** — `channel_setting_groups.py:154-175` already builds
`default-<user_id>`, `restricted-<user_id>` and friends, with a unique index from migration
`n6o7p8q9r0s1`. It is already tenant-private; it needs an FK.

Migration order, given `prestart.sh` runs `alembic upgrade head` unattended: DDL in migrations, data
moves in `backend/scripts/`, except where a move is provably behaviour-neutral.

- **Migration A1a**, online-safe only: create follows + index; `ADD COLUMN user.is_approved NOT NULL
  DEFAULT true` (PG11+, no rewrite); RBAC tables; `tg_quota_usage`; the settings table split and its
  data move, which is invisible while `get_app_setting` still ignores `user_id` and so can run
  unattended and be observed for a full release.
- **`scripts/backfill_channel_follows.py`** — one follow per channel, owner =
  `Channel.user_id or first superuser`, `--dry-run`, `ON CONFLICT DO NOTHING`, idempotent.
- **`scripts/audit_tenancy_drift.py`** — read-only, the gate for every later step: NULL/orphan
  `user_id` counts per table, channels with zero follows, settings keys still NULL.
- **Migration A2a** (in step A2), FKs: precondition assert, then per table
  `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` (`ShareUpdateExclusive`, not
  `AccessExclusive`), and `CHECK (user_id IS NOT NULL) NOT VALID` → validate → `SET NOT NULL` so
  PG12+ skips the full scan.
- **Migration A3a**, drops: corpus `user_id` columns and the migrated `Channel` columns. Irreversible
  in practice; do not run until the guard has been green and mutation-tested for a release.

## A2 — scoping

**`services/tenancy.py` is a pure transform**, not a read model. `scoped_select` builds a SELECT and
executes nothing; `assert_owner` compares two UUIDs. `test_pure_transforms_do_no_io` already permits
importing SQLAlchemy to build a `ColumnElement` (`post_filters.py` is the precedent), so declaring it
a pure transform buys a free mechanical guard: adding a `Session` to it turns the suite red.
Declaring it a read model buys nothing, since that check is only "never commits".

Dispatch by model class: user-owned → `.where(Model.user_id == user_id)`; follow-scoped → an `EXISTS`
against `tg_channel_follows`, never filtering `Model.user_id` because those columns are being dropped;
corpus-but-not-follow-scoped (`DiscoverHandleProbe`, `SyncMeta`) → unscoped, deliberately, with a
docstring. With `TENANCY_ENFORCED=False` every branch returns the unscoped select, byte-identical to
today, which is what makes A2 shippable green before the flip.

**`services/follows.py` is an aggregate**, sole writer of the table. `operator.py` is **deleted**, not
shimmed, along with its NULL-inclusive predicate (`operator.py:46`) and its `ENVIRONMENT == "local"`
fallback returning all rows (`:52-74`). Both existed to make a single-operator DB with stale stamps
behave; after the backfill neither is true, and keeping them leaks rows across users.

**`TENANCY_ENFORCED: bool = False`**, read in exactly one place, `tenancy.py::tenancy_enforced()`.
A guard greps for the symbol elsewhere: the failure mode of a flag is always the fourteenth place it
got read.

**Done** (ticket 03): the module, the classification, and the flag. Two things the plan did not
anticipate. The follow-scoped branch cannot be written before ticket 04 creates
`tg_channel_follows`, so it **raises** `NotImplementedError` there rather than picking one of the two
wrong answers — an unscoped statement leaks, an empty one is a silent outage, and a raise makes an
early flip a crash on the first query. `FOLLOW_KEYS` records the join column so ticket 04 has it.
And the classification guard's model walk has to be **recursive**: `User` and `Item` descend from
`UserBase`/`ItemBase`, so one level of `SQLModel.__subclasses__()` sees neither, and the guard would
have passed while blind to exactly the two tables `OUT_OF_SCOPE` exists to excuse.

**93 handlers across 14 modules take `_current_user: CurrentUser`** — auth enforced, identity
discarded. Dropping the underscore as each is converted gives a countdown, and
`test_route_module_hygiene.py` gains a rule that `_current_user` requires an allowlist entry with a
reason, so the convention cannot decay back into prose.

**`routes/data/admin.py` becomes Admin-only.** It is `CurrentUser` today and exposes `clear_table`,
`get_db_stats`, `get_table_sizes`, and `import_data_impl`.

**Wire shape is unchanged.** `frontend/src/types.ts:167` already exposes `Channel` as a flattened
merge of channel + setting-group fields, so the API already denormalizes; the read model joins
`follows` instead of `channel.user_id`. `types.conform.ts` and the projection tests stay green.

**`retention.py` splits four ways**: per-user log sweeps; corpus post sweep on the Admin's single
policy; per-user discover-report pruning (`_prune_discover_reports:77` currently orders over the
*whole table*, so one user's 50 reports would delete another's); and unchanged global asset pruning.

## Frontend

**Per-user localStorage namespacing.** ~30 keys leak between users on one browser.
`lib/settings/store.ts:11-18` already takes `SettingsReader`/`SettingsWriter` interfaces with a
`readerFromRecord` helper proving they are swappable. Add `lib/storage/scoped.ts` with a
`u:<userId>:` prefix, **where the id comes from the JWT `sub` claim decoded client-side without
verification** — it is needed synchronously at first render, before `usersReadUserMe()` resolves, and
a forged token gets you a namespace, not data. This also means **no new field on `DataContext`**, so
`architecture-invariants.test.ts`'s exact-ten-member assertion stays green honestly rather than being
edited around. `access_token` and `vite-ui-theme` stay unscoped in a declared `DEVICE_SCOPED_KEYS`.

Ten files to convert: `SettingsContext`, `DataContext:57,69,80,87`, `UIContext:79-173`,
`usePostFilters:75-142`, `useRecentCommands`, `useGuidedTour`, `useChannelGridSortState`,
`DatabaseManagement`, `network-settings-store`.

**Provider remount:** `routes/_tg/summarizer.tsx:76` → `<TgProviders key={currentUserId() ?? "anon"}>`.
**`_layout/admin.tsx:20-27`** calls `usersReadUserMe()` on every navigation, bypassing the query it
duplicates → `queryClient.ensureQueryData`.
**View-as ribbon** driven by the token's `act` claim, so it survives reload.

---

# Guards

Each states its reason; each names the mutation to watch go red. `CLAUDE.md` records six false
passes caught this way, including one guard that could not fail at all.

| Guard | Asserts | Mutation |
|---|---|---|
| `test_auth_flow_reachability.py` | every dependency-free route is middleware-exempt | remove a path from `_BASE_PUBLIC_PATHS` |
| `test_corpus_is_user_agnostic.py` | corpus models have no `user_id`; no module references it. *One scrape serves every follower.* | re-add `user_id` to `Post` |
| `test_cross_user_isolation.py` | parametrised over the whole route inventory: A's list holds none of B's ids; B's row is **404, not 403**. *The seam is every query, not one.* | drop the `where` from `list_channels_impl` |
| `test_follow_quota_paths.py` | AST inventory of every module constructing `Channel` or writing `ChannelFollow`, against a declared dict with reasons | add a bare `Channel(...)` elsewhere |
| `test_settings_table_split.py` | no global key is written to `tg_user_settings` or vice versa | write `jobs` to the user table |
| `test_quota_ladder.py` | over-Budget enqueues to best-effort, over-ceiling refuses, zero Budget means best-effort **not** blocked | make zero mean blocked |
| `test_channel_mutual_exclusion.py` | two concurrent syncs of one channel do not interleave cursor writes; the second coalesces | remove the claim |
| `test_impersonation_limits.py` | read-only by default; elevation refused against an Admin; no View as an `impersonate` holder; `acted_by` stamped | allow elevation on an Admin target |
| `test_admin_routes_are_superuser.py` | `data/admin.py` destructive routes reject a non-Admin | relax one |
| `architecture-invariants.test.ts` | only `scoped.ts`, `theme-provider`, `api/base.ts`, `useAuth` touch `localStorage.`; `logout` calls `queryClient.clear()` | add a bare `localStorage.getItem` |

**Two existing guards encode Mode A and must be inverted, not deleted:**
`tests/api/test_tenancy.py:98` asserts another user's channel is *not* synced, and
`tests/services/test_operator.py` tests the NULL fallback A2 removes.

Also touched: `test_service_kinds.py` (add `tenancy.py` pure transform, `follows.py` aggregate;
remove `operator.py`), `test_route_inventory.py`, the `test_*_projection.py` set,
`test_worker_count.py`, and `client-split.conform.ts` — verify rather than assume there, since a new
hand-written follow type must stay open while `UserPublic` stays closed. Twin-module rule stands:
`channel_photos.py` and `post_thumbnails.py` are the same module twice.

# Verification

```bash
cd backend && uv run alembic upgrade head
cd backend && uv run python scripts/audit_tenancy_drift.py            # clean before advancing
cd backend && uv run python scripts/backfill_channel_follows.py --dry-run
cd backend && TEST_POSTGRES_DB=app_test_mu uv run pytest tests/ -q
cd backend && TENANCY_ENFORCED=true TEST_POSTGRES_DB=app_test_mu uv run pytest tests/ -q
cd backend && bash scripts/lint.sh
cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
bash scripts/generate-client.sh                                       # ENVIRONMENT=production
bun run --filter tg-summarizer-frontend test:unit
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
cd frontend && PLAYWRIGHT_CHANNEL=chrome bunx playwright test --workers=1
```

CI is billing-blocked, so this is all local. The two-mode pytest run is not optional: an A2 that is
only green with the flag on is not revertable. **Rehearse migrations on a staging restore** and time
them, because `prestart.sh` runs them unattended on every boot.

**Two-user acceptance test:** Alice and Bob each follow `@shared` plus one private channel; assert
three channel rows and four follow rows. Each generates all four Artifact kinds and writes different
settings. Alice's channel list excludes Bob's; `GET /data/summaries/{bob_id}` as Alice is 404;
settings return each user's own; `DELETE /data/channels/@shared` as Alice removes it from her list
only and leaves `tg_posts` untouched; concurrent syncs coalesce to one; over-Budget work lands in
best-effort; `DELETE /users/{alice}` cascades her rows while `@shared` survives.

# Risks

1. **A2 is ~40 call sites, not one seam.** `test_cross_user_isolation.py` is parametrised over the
   route inventory so a missed reader fails by construction rather than by memory.
2. **`delete_channel` destroys shared corpus** — the only change here that loses data rather than
   leaking it. Land the unfollow/collect split first.
3. **Deferring most-eager-wins means N users on a popular channel cost N× the requests.** Bounded
   per user by the Budget, unbounded globally. Accepted deliberately; revisit per #40.
4. **Capacity.** Do not raise the worker count on the assumption the queue fixed it; `--workers 1`
   on the API tier is still a correctness constraint until all three of its reasons are externalised.
5. **PGMQ has no priority**, so the lane emulation is load-bearing. If a future need wants true
   priority within a lane, that is a reason to revisit the substrate, not to bolt on VT tricks.
6. **`SyncMeta` etag churn**: global etags now move whenever any user writes, so everyone
   revalidates more often. `api/http_cache.py` already sets `Cache-Control: private` with body-hash
   ETags, so there is no poisoning risk, only churn to measure.
