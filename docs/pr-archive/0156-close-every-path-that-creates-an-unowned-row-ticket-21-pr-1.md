# #156 🔒 Close every path that creates an unowned row (ticket 21, PR 1)

**State:** merged 2026-08-30 · **Branch:** `ticket-21-close-unowned-writes` into `main` · **Diff:** +1028 / -121 across 21 files · **Opened:** 2026-08-29

---

First of four PRs for ticket 21. The flag flips in PR 4; this one changes no behaviour on a single-account deployment.

## Why this exists

Ticket 34 backfilled the ownerless rows the fourteen `USER_OWNED` tables held and **deliberately left the columns nullable**, because the writers that produce them were still there. "34 is done" never meant the tables were clean — it meant the rows that existed at that moment were.

Under enforcement an unowned row is invisible to every account, refused to every reader by id, unwritable (and an import is one transaction, so the *first* one aborts a whole restore), and swept by **no retention window at all**, because ticket 20 runs the personal log families on their owner's `logRetentionDays`. That last one leaks in the exact shape of retention working.

## Two producers none of the five handover notes named

Tickets 34 and 35 handed this ticket five preconditions. An audit of every `USER_OWNED` write found two more, and both are worse:

- **`EmbeddingLog` was constructed with no `user_id` argument at all**, at both sites in `services/embeddings.py`. Not conditional on resolving an operator — every scheduler tick and every `POST /rag/embed` wrote an unowned row, and the route path had `current_user.id` in hand and dropped it on the way to the constructor.
- **`_regenerate_one` refilled the population it inherited.** `run_auto_summary` selected `Summary.user_id IS NULL` on purpose and regenerated each into a *brand new* unowned Summary, with its payload and its LLM and publish logs stamped the same way. The set did not shrink after ticket 34; it was topped up every tick.

## What is closed

| Producer | Fix |
|---|---|
| four personal log `upsert_*` | required, non-optional `user_id` |
| `EmbeddingLog` × 2 | stamped with the id the caller already held |
| `create_job` → `SyncJob` | required owner; the two scheduler paths resolve one or decline |
| five `ChannelSettingGroup` constructors | required owner, so no new `-global` row |
| `_regenerate_one` refill loop | the query selects only owned Summaries; owner threaded as a keyword |
| `_save_network_telemetry` × 2 twins | resolved through `resolve_follow_owner` — the busiest producer, one row per scraped page |

Ten optional-owner signatures narrowed with them, so `mypy` enumerated the sixteen call sites rather than leaving them to be found. Four were `user_id or channel.user_id`, where a non-optional first operand makes the second unreachable — the only way that fallback ever fired was the case that produced the unowned group.

## The pre-flight gate was failing on a correct database

`scripts/audit_tenancy_drift.py` is the gate for this flip, and it counted ticket 19's deliberately ownerless sync logs as drift: **5,880 findings on the dev database, `--strict` exiting 1 on all of them**. A NULL owner is now drift only on the `USER_OWNED` tables; orphan owners stay drift everywhere. Derived from `SCOPES`, not listed.

## The guard

`tests/services/test_unowned_row_creation_paths.py` walks **every** construction site rather than testing the paths that happen to have tests — the `EmbeddingLog` bug lived on a path `tests/api/test_rag.py` covers, and they all passed, because nothing asserted on a stamp.

Mutation-tested both ways, per the repo rule that a green suite proves nothing until you have watched it go red:
- dropping `user_id=` from an `EmbeddingLog` fails it with file and line
- re-adding `| None = None` to a log upsert fails it

It resolves import aliases, because the first draft **silently skipped `SyncJob`** — imported as `SyncJobRow`, and the most important writer in the inventory. Both exemption tables are checked in both directions, so a stale exemption cannot outlive the code it excused.

## Verification

- full suite green: 1914 passed, 2 skipped
- `mypy`, `ty`, `ruff` clean
- `audit_tenancy_drift.py --strict` exits 0 on the dev database, still printing the counts

## Also here

The ticket file is rewritten from the audit before starting, with the four-PR sequence and what each one owns. **Supersedes #155**, whose notes are preserved verbatim.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TuidU3wGEmjiXqtNi9a9Kv
