# Architecture guards — read this before "simplifying" something

Reached from the root `CLAUDE.md` when a guard fails, and before you add, change
or delete one.

The rules in `backend/CLAUDE.md` and `frontend/CLAUDE.md` are not all equal.
Prose decayed before: `CLAUDE.md` said *"never inline `BaseModel` in a route
module"* from B1 onward, and three modules were violating it when the guards
below were written.

Each row names the invariant and where it is asserted. **The row is the pointer,
not the summary.** Open the file for the full list of what it checks and why.

| Guard | Enforces | Kind |
|---|---|---|
| `frontend/src/types.conform.ts` | hand-written domain types match the server | compile error |
| `frontend/src/api/client-split.conform.ts` | the two-client split, **in both directions** | compile error |
| `frontend/src/lib/architecture-invariants.test.ts` | no browser DB; `DataContext` stays small; one theme owner; storage has exactly four owners; logout and stale-session clear the query cache; no Posts query key is built outside `postsRead` | test |
| `frontend/src/lib/posts/posts-view.test.ts` | every Posts read's key moves exactly when its body does, except the three departures it lists (window by `windowKey`, selection by revision, filter by printed text; ADR-036) | test |
| `backend/tests/api/test_route_module_hygiene.py` | no models in route modules; handlers annotate returns | test |
| `backend/tests/api/test_posts_view_guard.py` | no Posts or Discover route resolves part of a Posts view by hand (`view_of`, `resolve_posts_view`, ADR-036); no Action-path module (derived) builds its own Post read (ADR-038) | test |
| `backend/tests/api/test_openapi_has_no_ticket_ids.py` | no ticket id (`TB-05`, `ticket 12`) in any OpenAPI `description` or `summary`, which ships as JSDoc in the generated client; ids go in a `#` comment | test |
| `scripts/check_code_refs.py` | every backticked path.py::name reference outside dated records names something defined; a file path never names only a file the commit removes; checked at commit | hook |
| `scripts/check_test_ids.py` | every literal test id a Playwright spec names is rendered by `frontend/src`, checked at commit | hook |
| `scripts/generate_constants_catalog.py` | a module with a constant has a `CONSTANT_TOPICS` entry and no entry outlives its constant, at commit time, so a frontend-only change meets it before the backend suite | pre-commit hook |
| `backend/tests/services/test_service_kinds.py` | every service module declares one of the five kinds | test |
| `backend/tests/api/test_route_inventory.py` | declared routes are actually mounted | test |
| `backend/tests/api/test_*_projection.py` | response key sets, no invented `null`s | test |
| `backend/tests/services/test_photo_cache_lookup_cost.py` | image-cache lookups don't scan the directory, in **both** twin modules | test |
| `backend/tests/services/test_summary_list_payload_cost.py` | listing summaries never opens the corpus table, **and the detail call does** | test |
| `backend/tests/services/test_log_list_payload_cost.py` | log lists drop the bodies, the detail route keeps them, search still reaches them | test |
| `backend/tests/services/test_sync_schedule_stats_narrowing.py` | the scheduler fetches stats only where they can change its answer, and **still fetches them where they can** | test |
| `backend/tests/services/test_sync_job_flush_cost.py` | job progress rides the flush interval; terminal states still write immediately | test |
| `backend/tests/services/test_sync_meta_commit_cost.py` | the etag moves in the same transaction as the change it announces | test |
| `backend/tests/jobs/test_auto_sync_session_scope.py` | the scheduler closes its planning transaction before syncing | test |
| `backend/tests/deployment/test_worker_count.py` | the scheduler has left the API; enqueueing never drains locally; the sync tier is one replica | test |
| `backend/tests/services/test_proxy_worker_partition.py` | one worker per proxy slot; a bound walk never hops; the binding follows its slot | test |
| `backend/tests/services/test_adaptive_proxy_wait.py` | a 404 neither parks nor paces its proxy; the ladder widens, caps and converges, cooldown its top rung; only the web view is paced | test |
| `backend/tests/services/test_channel_mutual_exclusion.py` | one sync per Channel outside process memory; a live claim is not stolen and an expired one is; the second request rides the first uncharged; the claim never moves the schedule | test |
| `backend/tests/services/test_cross_process_progress.py` | a watcher sees progress the row does not have yet; creating a job does not claim it; a cancel reaches the running process | test |
| `backend/tests/services/test_sync_lanes.py` | every drained lane was created by a migration; a lane name is its Budget and tier; six lanes are the full product; a trickle never starves auto-sync | test |
| `backend/tests/services/test_lane_draining.py` | the weighting holds under **real load**; new normal work preempts a best-effort backlog; one account's backlog blocks nobody else; pause keeps messages visible and purge cancels the jobs it orphans | test |
| `backend/tests/core/test_pg_notify.py` | notifications cross a connection boundary and fan out to every subscriber | test |
| `backend/tests/services/test_sync_job_retention.py` | sync jobs are pruned by age but never while unfinished; restarts reconcile | test |
| `backend/tests/api/test_public_route_exemptions.py` | routes with no auth dependency are middleware-public, **and** every exemption still has such a route | test |
| `backend/tests/api/test_view_as.py` | every mutating operation is refused or allowlisted with a reason; `sub` is the target and `act` the Owner; a dead target does not sign the Owner out | test |
| `backend/tests/api/test_view_as_elevation.py` | elevation is refused for a target holding any permission while an Admin stays viewable; a session cannot widen or nest itself; every artifact family records the acting Owner and an ordinary write clears it; an AST guard fails a committing write that does not stamp | test |
| `backend/tests/api/test_view_as_spend.py` | an elevation cannot spend; a safe method on a spend path still is one; the resource category is the exact set the inventory names | test |
| `backend/tests/api/test_admin_scoped_export.py` | an export names one subject; the default is the caller, not everybody; Follows, all four artifact families and personal settings travel and nobody else's do; the count is readable with the body unconsumed; a posts-only import leaves rows its account can read | test |
| `backend/tests/api/test_permission_checks.py` | authorisation reads roles, never `is_superuser` or a role name; the superuser kept its access | test |
| `backend/tests/services/test_follows.py` | the follow row carries what is private about watching a channel; `follows.py` is its only writer | test |
| `backend/tests/services/test_channel_creation_paths.py` | every Channel-creation path writes a Follow; the follow table has one writer; the guard's own function names still exist | test |
| `backend/tests/services/test_setting_declarations.py` | every Setting is declared once, on a classified key, with a valid default; browser rows agree with the schema | test |
| `backend/tests/api/test_settings_registry.py` | each Account reads its own rows and writes only what it may; Configuration is never written; the etag rides the write's commit | test |
| `backend/tests/deployment/test_constants_catalog.py` | the constants catalog is regenerated, and every module with a constant has a topic | test |
| `backend/tests/services/test_settings_table_split.py` | every settings key is classified with a reason; the two tables refuse each other's keys; the sync **and retention** carves are partitions; one writer per table | test |
| `backend/tests/jobs/test_retention_split_four_ways.py` | the corpus sweep ignores who scraped the row; one account's log window never reaches another's; shared and ownerless rows run on the deployment window and nothing else does; report caps are per account | test |
| `backend/tests/services/test_unfollow.py` | removal drops the follow and nothing else; a foreign channel is 404; a second account's Posts survive | test |
| `backend/tests/jobs/test_retention_collects_unfollowed.py` | retention collects only the Channels nobody follows, with their dependent rows | test |
| `backend/tests/services/test_tenancy_seam.py` | every table is classified or excused with a reason; scoping is byte-identical while the flag is off; the flag has exactly one reader | test |
| `backend/tests/api/test_account_isolation.py` | **every mounted operation is probed with two live accounts or excused with a typed reason**; a foreign row is that family's own 404; the flag off reopens cross-account reads | test |
| `backend/tests/deployment/test_env_example_matches_defaults.py` | `.env.example` ships `config.py`'s value for every boolean **and every integer**, or names the divergence | test |
| `backend/tests/deployment/test_ci_path_filters.py` | docs-only main pushes skip Playwright shards and staging deploys; a broken Playwright classifier cannot report green | test |
| `backend/tests/deployment/test_crap_ratchet.py` | no function above CRAP 30 unless `scripts/crap/baseline.json` gives a reason; a listed one is pinned both ways until it leaves; CI checks the **combined** coverage | test |
| `backend/tests/services/test_artifact_tenancy_scoping.py` | all four artifact families and the History scope by owner, per leg, with that family's own 404 detail; writes and deletes refuse a foreign row **even while the flag is off** | test |
| `backend/tests/services/test_post_tenancy_scoping.py` | the feed, lookup, counts and Discover scope in **both** query shapes; the followed-channel set is scoped too; probes stay corpus and say why | test |
| `backend/tests/services/test_sync_log_channel_telemetry.py` | a second Follower sees telemetry the first produced; search and `searchInDetails` stay inside the Follow; the row stores no owner even when handed one | test |
| `backend/tests/services/test_import_write_scoping.py` | an import never overwrites another account's row, in **both** flag states; every table it writes is checked or excused, derived from the AST; **only reads use the flag-gated ownership guard** | test |
| `backend/tests/services/test_discover_dismissals_are_per_account.py` | the dismissal key carries its owner and a second account can dismiss what the first already did, under **both** flag states | test |
| `backend/tests/services/test_credential_tenancy_scoping.py` | both credential lists read through the seam, not a hand-rolled owner filter; `user_id` is a required keyword; an ownerless row's fate is pinned in both flag states | test |
| `backend/tests/services/test_setting_group_and_job_scoping.py` | the group list reads through the seam and is **unfiltered** with the flag off; the lookup map stays unscoped and says why; the running-job read is the caller's; all three write doors refuse a foreign group in **both** flag states | test |
| `backend/tests/services/test_setting_group_name_identity.py` | a duplicate group name is the route's 409 and never a `UniqueViolation`, in both flag states; two accounts may hold one name; the filter keeps no unowned leg and consults neither the flag nor `scoped_select` | test |
| `backend/tests/services/test_auto_publish_scoping.py` | a foreign credential is refused **before** it is decrypted and answers as an absent one; a refusal reaches the publish log; the send is attributed to the Summary's owner | test |
| `backend/tests/services/test_owner_backfill.py` | the migration's frozen table list is the one `SCOPES` derives; no unowned user-owned row survives it; a payload takes its parent's owner; a duplicate setting group is merged rather than stamped into a unique-index violation; a fresh install completes where a used deployment with no superuser is refused | test |
| `backend/tests/services/test_superseded_columns.py` | the dropped columns are derived from `SCOPES` rather than listed; no module names one **or passes one as a constructor keyword** | test |
| `backend/tests/services/test_follow_always_has_a_group.py` | the migration rescues a follow still holding NULL before the drop; the scraper skips a group-less follow instead of raising; a chat-id collision freezes **every** follower; `run_db` keeps the ParamSpec that checks its call sites | test |
| `backend/tests/services/test_quota_ledger.py` | one Request per fetch however many attempts; only what reached Telegram; concurrent meters stay apart; nothing prunes the ledger | test |
| `backend/tests/api/test_request_stats.py` | one Request per attempt that left, none for a full Lane; kind, Account, Lane and best-effort from the sync; pictures their own uncharged page; each Wasted cause; one chain across both retry layers; three tiers agree; the rollup replaces; Operator-only; no test in it records kind other unless it asks for `expects_other` | test |
| `backend/tests/api/test_quota_usage_route.py` | `GET /quota/me` reports the ledger for the caller and nobody else | test |
| `backend/tests/services/test_lane_selection.py` | the **real** enqueue picks the lane; the boundary is `>=`; zero is always best-effort and negative unlimited; a failed ledger read picks normal; no new path syncs outside the ladder | test |
| `backend/tests/services/test_quota_ceilings.py` | a zero allowance degrades where a zero ceiling blocks and a negative one never does; the three layers resolve each number independently; a lift reaches one account, one Budget, one **day**; the refusal reaches the walk and not only the enqueue; an unreadable ledger refuses | test |
| `backend/tests/deployment/test_tg_cleanup_inventory.py` | every `tg_*` table is truncated between tests or excused, in both directions; the failure it prevents is a **green** test in an unrelated module | test |
| `backend/tests/deployment/test_claude_md_budget.py` | the root, backend and frontend `CLAUDE.md` and this file each stay inside their budget and cite no path that has moved; the root points at the other three; every `*Enforced:*` pointer is a row here; runs at commit too | test |
| `backend/tests/deployment/test_adr_index.py` | every ADR has a row in `docs/adr/README.md` and lives in `docs/adr/` | test |
| `backend/tests/api/test_send_email_call_sites.py` | every `send_email` caller checks `emails_enabled` first, the pair rather than the site | test |
| `backend/tests/api/test_approval_gate.py` | every data router requires an approved account; unknown routers fail, exemptions state a reason | test |
| `backend/tests/api/test_registration.py` | signup answers identically for a taken and a free address, and never returns an account | test |
| `backend/tests/core/test_permissions.py` | no stranded permission, no permission on the default role, seeded rows match the constants | test |
| `backend/tests/deployment/test_edge_rate_limit.py` | the auth paths are rate limited at Traefik, and that router keeps its service, priority, and compression | test |
| `backend/tests/services/test_ai_key_payment_rule.py` | each Artifact purpose resolves the caller's Key and each shared purpose the Operator's; a foreign Key id is refused before decrypt and answers as an absent one; every `get_provider` call site is declared **and** resolves a Key | test |
| `backend/tests/services/test_llm_log_provenance.py` | a scheduled Summary spends the Key it stored; every refusal files a failed log row and none disables the schedule; no credential reaches a logged body | test |
| `backend/tests/api/test_openai_compatible_provider.py` | the credential never reaches a URL; the model list is the endpoint's own answer; a provider with no catalogue falls back to free text where a rejected Key says so and loses its stamp; a dropdown re-render costs no outbound call | test |
| pre-commit `generate-frontend-sdk` | the committed client matches the backend | hook |

**A fix applied to one of two twin modules is half a fix.** `channel_photos.py` and
`post_thumbnails.py` are the same module twice over (same `_META_SUFFIX`, `_meta_path`,
`_find_image_path`, `has_cached_*`, bounded extension set). The thumb cache was fixed to
probe extensions instead of globbing, with the reasoning in its docstring; the avatar
cache kept the glob for two more months and turned a channel list into 30 seconds. Its
guard is parametrised over *both* modules for that reason — when you fix one of a pair,
guard the pair.

`client-split.conform.ts` is the pattern worth copying. It asserts not only that
the *generated* models stayed closed, but that the *hand-written* ones are still
open — so closing one server-side breaks the build and tells you the call can now
move. **A deliberate exception that nothing checks becomes a leftover nobody dares
touch.** Assert the reason, not just the state.
