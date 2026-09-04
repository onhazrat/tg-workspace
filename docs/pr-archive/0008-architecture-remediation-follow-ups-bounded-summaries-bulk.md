# #8 Architecture remediation follow-ups: bounded summaries, bulk deletes, reliable e2e

**State:** merged 2026-07-21 · **Branch:** `remediation-followups` into `main` · **Diff:** +1438 / -197 across 36 files · **Opened:** 2026-07-21

---

Follow-ups to the architecture remediation work merged in `b4ec5cd`, per `docs/architecture-remediation-plan.md`.

## Commits

**`ae30a3e` — Bound `GET /data/summaries` and close the language-detection loose end**
Light list projection + `GET /data/summaries/{id}` detail endpoint, plus server-side `?search=`. Driven by measurement on staging: across 31 summaries, `promptText` was 33 MB of the payload (2.9 MB max, present on all 31) versus 253 kB of `text`. Dropping the three heavy fields from the list response is what moves the number.

**`860f932` — Bulk-delete four unbounded write paths found by the `.all()` audit**
`delete_channel`, `clear_channel_sync_state`, `prune_sync_state_below` and `_clear_channel_posts` each materialised every matching row before deleting or counting it — the same shape that drove worker RSS to 3.09 GB. None had test coverage, which is why converting them did not move the suite; `tests/services/test_bulk_deletes.py` now covers them. Audit written up in `docs/unbounded-query-audit.md`.

**`7d5b808` — Run the e2e suite serially and fix two real Discover spec bugs**
See the commit message for the full analysis. Two genuine spec bugs (a dev-DB dependency and a missing postcondition on selection pinning); everything else was worker contention on a shared backend.

## The e2e change is the one worth reviewing carefully

Six specs were failing. Three of the four "pre-existing failures" passed the moment they ran in isolation, so the recorded diagnosis was wrong.

| | wall clock | result |
|---|---|---|
| parallel | 6.8–16.5 min | 1–3 failures, a different set each run |
| serial | 2.6 min | 51/51 passed |

Every spec shares one backend, one database and one user account, and most setup paths fetch the unbounded channel list (T4.3). Workers starved each other, and the failures kept migrating to specs that had passed repeatedly — always with timeout signatures. Pinning `workers: 1` is both faster and deterministic.

This also removed two workarounds I had added earlier in the same investigation: a `describe.serial` block and a set of poll-timeout bumps. Both were treating symptoms, and the `describe.serial` block had the bad property of skipping five specs after any one failure.

## Verification

- `bunx playwright test tests/summarizer.spec.ts` — 51/51, confirmed twice
- `bun test src` — 457 passed
- `bunx tsc` — clean on `tsconfig.build.json` and `tsconfig.json`
- `bun run lint`, `bun run test:tg-ui` — clean
- `uv run pytest tests/ -q` — 465 passed (as of `860f932`)

CI is billing-blocked on this repo, so red checks are jobs that never started. Local runs are the real gate.

## Not included

Step 2 of the remaining plan — porting `buildFilteredPostsFromRaw`'s filter semantics into query parameters — is not here. That is the change that actually alters Discover's load profile on staging, and it is still unstarted.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
