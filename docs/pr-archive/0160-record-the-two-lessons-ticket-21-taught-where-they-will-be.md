# #160 📝 Record the two lessons ticket 21 taught, where they will be read

**State:** merged 2026-08-30 · **Branch:** `ticket-21-record-two-lessons` into `main` · **Diff:** +2 / -0 across 1 files · **Opened:** 2026-08-30

---

Two lines in CLAUDE.md's tenancy section. Both lessons were found by review during ticket 21, both are already fixed and guarded on `main`, and neither was recorded anywhere a future reader would look — only in a PR body and a ticket file.

## 1. A flag's default lives in two files, and the suite can only see one

PR 4 moved `TENANCY_ENFORCED` to `True` in `config.py` and left `.env.example` shipping `false`. That file documents every tunable and is what a root `.env` is built from, so a fresh install would have run **unenforced with the whole suite green** — the flip shipped and did not ship at the same time, depending on how a deployment got its `.env`.

This is not a check that broke. It is a class the suite **structurally cannot** catch, and the reason is that the two tests that could have seen it both look away deliberately:

- `test_the_flag_ships_on` reads `model_fields[...].default` rather than the resolved setting, so the rollback rehearsal (`TENANCY_ENFORCED=false pytest`) does not fail it for the one reason that is not a defect.
- Every probe in `test_account_isolation.py` pins the flag on, for the same reason.

So the resolved configuration was unasserted in **both** directions, and the single file that decides it for a real deployment sat outside the tests entirely.

`tests/deployment/test_env_example_matches_defaults.py` closes the class. **Booleans only**: a general key-match guard drowns in placeholders and hostnames, while a boolean is a switch whose two values are both valid configurations — so a mismatch looks wrong nowhere. That is the same shape as the flag it was written for.

## 2. A check can stop applying because its input got *better*

Every other finding in the tenancy programme was a missing check. This one was a check that went dead when the data model improved, in the same commit.

`POST /jobs/sync/{id}/cancel` shared `_visible_job` with the two read routes, and that was safe only because a sync job used to be the caller's or **nobody's** — the scheduler's carried a NULL owner, so a foreign job hit the `JOBS_MANAGE` branch and was refused whatever the flag said. Ticket 21 PR 1 gave scheduler jobs a real owner, and a foreign job then fell through to the flag-gated `assert_owner` alone, which on the shipping config is a no-op: any signed-in account could stop any other's in-flight sync by guessing an id.

Fixed by `_cancellable_job`, and the structural guard now names **which** of the two guards each handler must call rather than accepting either. The identical shape appeared again on the three bulk-follow routes, where the cancel resolved the job, cancelled it, and *then* answered 404 — the refusal arriving after the damage.

The rule worth keeping: **when a nullable column gains a real value, re-read every branch that was reachable only because it was null.**

## Ordering

Config first. It is the more load-bearing of the two, because it is a whole class rather than a single dead branch.

## Provenance

Both framings were sharpened with the ticket-manager session during review. The recommendation to record them in CLAUDE.md came from there; the decision to make the edit came from the user, because CLAUDE.md governs how the assistant works and a peer suggesting a change to it is exactly the case that routes to a human.

## Verification

Doc-only change. The three guards it names all pass: 92 passed, 1 skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
