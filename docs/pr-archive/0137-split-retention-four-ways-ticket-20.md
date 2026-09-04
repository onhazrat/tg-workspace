# #137 🔒 Split retention four ways (ticket 20)

**State:** merged 2026-08-26 · **Branch:** `worktree-ticket-20-split-retention` into `main` · **Diff:** +1928 / -260 across 36 files · **Opened:** 2026-08-26

---

Post retention becomes a deployment policy an Admin sets once. Log and report retention stay personal. One person's settings can never delete another's evidence.

## The problem

Every sweep ran on one `retention` blob narrowed by `user_id == operator OR IS NULL` — a filter that looked like scoping and was not. It protected nobody once a second account existed:

- `postRetentionDays` was one number any account could set, and it deletes **every** account's Posts on the next sweep. Ticket 18 gated the write; the number was still shared, so the gate was the only thing between a new account and table clearing on a timer.
- `logRetentionDays` was one number too, so whoever saved it last decided how long everybody else's evidence survived.
- Discover reports were pruned across the whole table. The count cap was the sharper edge: one account generating fifty reports in an afternoon pushed every other account's newest report past the offset and deleted it.

## The shape

The window follows the scope — the rule `services/tenancy.py` already establishes for reads.

| Rows | Window | Home |
|---|---|---|
| Posts, embeddings, translations, sync state | `postRetentionDays` | global |
| Sync log bodies | `payloadRetentionDays` | global |
| Sync logs, network logs, **and any log row with no owner** | `sharedLogRetentionDays` **(new)** | global |
| Publish / LLM / embedding logs you own | `logRetentionDays` | per-User |
| Your Discover reports | `reportRetentionDays`, `reportRetentionMax` | per-User |

Channel collection and asset pruning stay deployment-wide and are not windows at all.

## Two things the ticket's checkboxes did not say

**Sync and network logs, and ownerless rows, needed a window of their own.** Sync logs became Channel telemetry in ticket 19 and network logs record proxy behaviour, so neither belongs on a per-User window. And `user_id` is nullable on all five log tables — every `upsert_*` takes it as an optional argument, so a background job writes owner-less rows as a matter of course. Once the personal families moved to per-account windows, all three were reachable by **no** window: a leak that looks exactly like retention working. `sharedLogRetentionDays` is seeded from the deployment's existing `logRetentionDays`, so nothing changed horizon.

**Ownerless Discover reports had to be adopted.** Per-account pruning cannot reach a report with no `user_id`. The migration assigns them once, using the same owner-resolution rule as `follows.resolve_follow_owner` and the ticket 06 migration. Every report written since ticket 17 already carries an owner, so this is complete rather than a rule the job keeps applying. Logs are deliberately *not* adopted — new ownerless rows appear daily, so `sharedLogRetentionDays` is the standing answer.

## Ticket 19's handover, closed

`delete_old_logs` narrowed itself to `user_id == operator OR IS NULL` while its docstring said it swept every account — an administrative sweep quietly skipping everybody else's rows. The filter is gone from it and from `expire_sync_payloads_stmt`, where narrowing it was how payloads outlived the log rows they belonged to.

## Notes

- **The wire shape did not change.** `retention` is now a facade over both settings tables exactly as `sync` already was; regenerating the client touched only docstrings. A non-Admin's PUT succeeds and writes only their own windows — refusing outright would mean nobody but an Admin can say how long to keep their own logs. `test_the_retention_facade_keeps_a_persons_own_windows` asserts `postRetentionDays` does not move, which is a stronger check than the 403 it replaces.
- **A personal retention field with no owner raises**, where `save_sync_settings` drops one (the scheduler writes `sync` with no account behind it). Nothing writes retention without a User, so dropping would only ever mean a window silently keeping its default. The raise found four call sites doing exactly that.
- **`SHARED_LOG_TYPES` / `PERSONAL_LOG_TYPES` partition the five families** and are both derived from `tenancy.SCOPES`, never listed — a family cannot fall out of both or into both.

## Verification

- Full backend suite on a fresh database: **1564 passed, 2 skipped, 0 failed**.
- Frontend: 882 unit tests pass, `tsc --noEmit` clean, biome clean.
- `mypy` clean; `ty` shows 81 diagnostics against 83 on the pre-change baseline (no new ones).
- Every assertion in the new guard was **mutation-tested** — see its module docstring, including the one exception that survives its mutation and says why.

Unblocks ticket 21 together with ticket 30.

Design note: `docs/retention-split-plan.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Comments

### onhazrat on 2026-08-26

## Self-review pass (03a3bbb)

The `/code-review` agent died on a session limit, so I reviewed the diff myself. It found one real defect and two claims that were not true.

**`deletedPayloads` under-reported.** The shared log sweep takes sync payloads with their parent (`tg_sync_log_payloads` has no FK to cascade from), but the new `_delete_logs_before` discarded that rowcount — so the job reported only what the *payload* window removed. Rows went either way; the operator's only view of how much disk came back was wrong. The three sweep functions now return a `LogSweep` naming both numbers. `delete_old_logs` still hands the route a plain dict, because the route maps every key through `LOG_MODELS` and would raise on a sixth key that is not a log family. Guarded by `test_the_shared_sweep_reports_the_payloads_it_removed`, watched to fail.

**The migration's no-account branch skipped the shared window.** It returned before writing anything, so a database with saved settings and no users would have moved the sync and network families to the stock 30 days instead of keeping the window it had. It now writes the policy row either way.

**"The next deploy finishes the move" is false** — in this migration and in ticket 06's, which is where I copied the wording from. Alembic stamps a revision and does not run it twice. Corrected here rather than repeated; ticket 06's migration is already applied and not mine to edit. Worth someone's attention separately.

Also recorded rather than changed: report pruning is two indexed statements per account per hour and is deliberately *not* grouped the way the log sweep is. The docstring names the account count that would justify the `row_number() OVER (PARTITION BY user_id)` version, so the next person is deciding rather than guessing.

### Migration verified against a seeded database

Two accounts, an old blob (`postRetentionDays 45`, `logRetentionDays 14`, `payloadRetentionDays 3`, `reportRetentionDays 60`, `reportRetentionMax 7`), and one ownerless legacy report:

- global row → `{postRetentionDays: 45, payloadRetentionDays: 3, sharedLogRetentionDays: 14}` — the shared window seeded from the old log window, **not** the env default
- both accounts → their own `retention_prefs` row with the old values
- the legacy report → adopted by `FIRST_SUPERUSER`
- downgrade → restores the original blob byte for byte, drops the prefs rows, keeps the adopted owner
- upgrade again → identical result

Also checked the no-accounts path: the policy row is written with the seeded window and the personal fields stay readable in place.

Full backend suite after the fixes: **1565 passed, 2 skipped, 0 failed** on a freshly created database.
