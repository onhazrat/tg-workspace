# Temporarily disabled CI workflows

**Disabled on 2026-07-30. Nothing was deleted — only the event triggers are commented out.**

## Why

GitHub-hosted Actions minutes are billing-blocked on this account. Every GitHub-hosted
workflow was therefore failing *before its first step ran* — the failing jobs report
`steps=0`, i.e. GitHub never allocated a runner. That produced a permanently red PR and
`main` status with no signal in it, which is worse than no status at all.

This repo is private on the free plan, so it has no branch protection and no required
status checks (`repos/.../branches/main/protection` returns 403). Disabling these
workflows therefore blocks nothing.

## What is disabled

Each file below has its `push:` / `pull_request:` triggers commented out behind a
`CI-DISABLED` marker, with `workflow_dispatch:` left in place so it can still be started
by hand:

| Workflow | File |
| --- | --- |
| Test Backend | `test-backend.yml` |
| Test Frontend Unit | `test-frontend-unit.yml` |
| Test Docker Compose | `test-docker-compose.yml` |
| Playwright Tests | `playwright.yml` |
| pre-commit | `pre-commit.yml` |
| Zizmor | `zizmor.yml` |

## What is NOT disabled

- `deploy-staging.yml` and `deploy-production.yml` — these run on **self-hosted** runners,
  which are not billed and not blocked. Staging deploys on every push to `main` and is
  currently the only green check.
- `bump-pre-commit-hooks.yml` — schedule-only and already gated on
  `github.repository_owner == 'fastapi'`, so its job skips without consuming minutes and
  never goes red. Left untouched.

## How to re-enable

Find every disabled trigger:

```bash
grep -rn "CI-DISABLED" .github/workflows/
```

Then, in each file, uncomment the `push:` / `pull_request:` block and delete the
`CI-DISABLED` comment. Keeping `workflow_dispatch:` afterwards is fine and recommended.

Or restore all six at once by reverting the commit that disabled them:

```bash
git log --oneline -S "CI-DISABLED" -- .github/workflows/   # find the commit
git revert <commit>
```

## Caveats while disabled

- **Nothing lints or tests on push/PR.** Run the checks locally before merging:
  `cd backend && bash scripts/lint.sh && uv run pytest tests/ -q`,
  `bun run lint`, `bun run --filter tg-summarizer-frontend test:unit`.
  `cd backend && uv run prek run --all-files` covers the `pre-commit` workflow's job.
- **Manual `workflow_dispatch` still needs paid minutes**, so it will fail the same way
  until billing is restored. It is kept so the workflows stay visible and runnable the
  moment billing is fixed — and because `on:` cannot be empty.
- Manually dispatching `playwright.yml` from `main` will skip the test job anyway: its
  `changes` gate uses `dorny/paths-filter`, which reports no changes when the ref matches
  the default branch. This is pre-existing behaviour, not caused by disabling.
