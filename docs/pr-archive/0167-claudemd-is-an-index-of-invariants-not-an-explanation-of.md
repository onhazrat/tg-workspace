# #167 📉 CLAUDE.md is an index of invariants, not an explanation of them

**State:** merged 2026-09-02 · **Branch:** `claude-md-budget` into `main` · **Diff:** +495 / -206 across 3 files · **Opened:** 2026-09-02

---

## The problem

`CLAUDE.md` reached **151,139 bytes** (23,121 words, ~38k tokens), having grown 22x in six weeks:

```
2026-07-24    6,795 bytes
2026-08-19   19,178
2026-08-24   37,672
2026-08-27   79,073
2026-09-02  151,139
```

Every byte is loaded into every agent session before a question is asked, so its size is a cost paid on work that never touches the subsystem being described. 81% of it was one "Backend architecture" section.

It was not stale. All 57 cited paths still resolved. It was accurate and enormous, which is the harder problem.

## Why it was large

The file carried the **argument**, not the rule. The sync-log bullet stated one rule in ~250 words, because it also relitigated the ignored `user_id` parameter, the payload denormalisation, the `assert_owner` NULL branch and ticket 18's write-takeover guard. The rule is 15 words. The defence is 235. That ratio held across the section.

And the argument already existed twice. `app/services/tenancy.py` opens with the same reasoning at 644 lines; `tests/services/test_tenancy_seam.py` opens with a better-organised version again, with a "Watched to fail" section `CLAUDE.md` never had. This was the third copy, and the only one nothing checks.

Nothing evicted, so it grew. Each ticket appended its findings and no step ever removed one, so tickets 03 through 35 are all still paying rent on sessions that only touch the frontend.

## What this does

**`CLAUDE.md`: 151,139 → 41,932 bytes** (340 → 252 lines). ~38k tokens per session down to ~10k.

Every rule is now a claim plus its `*Enforced:*` pointer. All 47 top-level invariants survive, and so does every trap that would let a reader actively break something: no `GZipMiddleware`, no hand-edits to the generated client, do not scale the sync tier, alembic's `env.py` must import every model module, assert the `detail` string rather than the status on the two auth gates, `TENANCY_ENFORCED` has exactly one reader.

The guard table stayed, because rule/enforcement/kind in one row is the highest value per byte in the file. Its cells became pointers rather than paragraphs (17.5 KB → 11.2 KB). Some rows ran to 850 characters restating everything the test file asserts; the row *is* the pointer, so it names the invariant and stops.

**One rule was dropped rather than shortened.** "Do not add a follow filter to `list_channels` ahead of ticket 15" had inverted: `list_channels` takes `scoped_select` now, so the warning was telling a reader not to do the thing that is already done.

**`docs/agents/architecture-rationale.md`** archives the old Backend and Frontend sections verbatim, with a preamble saying it is a snapshot and the enforcing test is the authority. Ticket-by-ticket narrative stays in `docs/*-plan.md`, where it already lived.

## The eviction step

`backend/tests/deployment/test_claude_md_budget.py` is what the file never had. It asserts a 275-line / 48,000-byte ceiling, that every cited path resolves, that every `*Enforced:*` pointer in the prose is a row in the guard table, that every row's file exists, and that no guard is listed twice.

The ceiling sits 23 lines above current **on purpose**. A ceiling with slack does not fire until the file has already doubled, which is the failure this is for. The module docstring has a "Raising the budget" section arguing that raising the numbers is the last option, not the first.

**It found a real gap on its first run.** `test_quota_usage_route.py` and `test_follows.py` were cited in the prose as enforcing something and appeared nowhere in the guard table. That drift predates this PR; both are rows now.

## Mutation-tested

Per the repo's own rule, each assertion was watched going red:

| Mutation | Result |
|---|---|
| Paste a paragraph back | budget test fails |
| Rename a cited test file | 3 tests fail |
| Add an `*Enforced:*` pointer with no table row | coverage test fails |
| Delete a table row still cited in prose | coverage test fails |
| List one guard twice | duplicate test fails |
| Restored | 5 passed |

## Verification

- `tests/deployment`: 34 passed, 1 skipped
- `ruff check`, `ruff format`, `ty check`, `mypy` clean (pre-commit ran all of them)
- No application code changed. This is docs plus one new guard.

CI is billing-blocked, so expect no checks on this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01BFhR1ZhFbadZ9HPUf7gFpg
