# #159 🔐 Two accounts cannot see each other: flip the flag (ticket 21, PR 4)

**State:** merged 2026-08-30 · **Branch:** `ticket-21-flip-the-flag` into `main` · **Diff:** +2394 / -173 across 46 files · **Opened:** 2026-08-30

---

Last of four PRs for ticket 21, and the acceptance gate for the whole tenancy programme. Stacked on #158, which is merged.

`TENANCY_ENFORCED` ships **`True`**. `scoped_select` now filters — a user-owned row by its owner, a follow-scoped one by an `EXISTS` against `tg_channel_follows`, corpus not at all.

## The guard is an inventory, not a sample

`tests/api/test_account_isolation.py` classifies **every one of the 135 mounted operations**: probed here with two live accounts, or excused with a *typed* reason. An operation in neither map fails the guard, so a route added next quarter cannot join the API without somebody answering "whose rows does this touch?" — the one moment that question is cheap. Same shape as `tenancy.py::SCOPES` and `test_import_write_scoping.py::IMPORT_WRITES`, for the same reason: the failure mode of tenancy work is never the path somebody thought about.

`Reason` is an enum rather than free text because five kinds of "this is fine" behave differently. `NOT_ROW_ADDRESSED` will never need a probe; `COVERED_ELSEWHERE` names a file that could be deleted; `DEPLOYMENT_WIDE` is a decision a later ticket may reverse. One string bucket lets all three rot into "we looked at it once".

A probe asserts **404 with that family's own detail string** — not 403, which confirms the row exists, and not a generic "Not found", which moves the enumeration oracle into the body. Lists assert both directions, because a route returning nothing satisfies the absence and one returning everything satisfies the presence. Two premise tests sit underneath: that the fixtures really hand back different accounts, and that the seeder writes the owner it is given. Every isolation assertion here is vacuous if either is false.

**Mutation evidence:** twelve of the probes go red with enforcement off. That is also why they pin the flag on rather than reading the default — the suite is deliberately run in both states.

## Off is the rollback now

The four `test_disabled_*` cases pin the flag off explicitly instead of describing the shipping config, and `test_the_flag_ships_off` is **inverted rather than deleted**. It reads the *field default* rather than the resolved setting, so the rollback rehearsal (`TENANCY_ENFORCED=false pytest`) does not fail it for the one reason that is not a defect.

What a rollback costs is stated once, in `test_turning_the_flag_off_reopens_cross_account_reads`: pre-seam means every account sees every account's rows, because that is what a single-operator deployment's queries did. It is for an emergency, not a preference.

## Getting the suite green: 163 → 0

Two shared helpers took most of it:

- **`ANY_READER` became a real seeded account** (PR 3) — a fabricated uuid returns nothing under a scoped read, so assertions would have gone green-to-empty and passed for the wrong reason.
- **`add_test_channel` defaults its Follow to the operator**, not to `ANY_READER`. The great majority of callers read back through the test client as `FIRST_SUPERUSER`, and an any-reader follow leaves them exactly as empty as no follow at all. One line, twelve tests.

The rest is per-file. A test that seeds bare Posts and reads them back was asserting pre-tenancy behaviour; `follow_channels` says so at the seam instead of leaving thirty files quietly reading an empty list.

**Three tests changed their claim rather than their fixture**, because the behaviour genuinely moved:

- `POST /data/logs/sync` is create-only for follow-scoped telemetry (ticket 19), and that rule is gated — so it began applying here. The payload-clear moved onto `upsert_sync_log`, which is what the importer calls, and the door's refusal gained a test of its own.
- The "falls back when no follow exists" case is unreachable through `list_channels` now, by construction: visibility *is* the follow, so `follows_for_user` finds the very row whose absence the branch is about. It is asserted against `channel_to_camel`, where the branch still runs on the single-channel path, plus a new test for the visibility rule that replaced it.
- `test_a_sync_job_nobody_owns_is_admin_only` had already become impossible in PR 3; here the foreign-job case is parametrised over both flag states.

## Known, recorded, not fixed here

- **`POST /data/posts/bulk` writes rows nobody can read** until the handle is followed. A full export/import is unaffected. Auto-following every handle in an uploaded file is not obviously right — **ticket 28's** decision, where import learns to carry a subject.
- **The embedding backfill covers one account's channels.** `job_embeddings` resolves a single actor and `backfill_embeddings` selects that actor's followed channels. Not a flip regression — it was `operator OR NULL` before PR 2, the same single-actor shape — and it under-covers rather than leaks. **Ticket 26's**, since fixing it is a quota question as much as a tenancy one.

## Verification

- **Suite green in both flag states: 1947 passed, 2 skipped, each way**, under random ordering.
- `mypy app`, `ty check app`, `ruff check`, `ruff format --check`: clean.
- `_typos.toml` gained two entries: backticked git SHAs, and the deliberate `"alph"` prefix in the palette search test.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
