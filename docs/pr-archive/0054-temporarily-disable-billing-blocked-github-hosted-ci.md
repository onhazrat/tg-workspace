# #54 🚧 Temporarily disable billing-blocked GitHub-hosted CI

**State:** merged 2026-07-30 · **Branch:** `worktree-disable-billing-blocked-ci` into `main` · **Diff:** +140 / -47 across 8 files · **Opened:** 2026-07-30

---

## Why

GitHub-hosted Actions minutes are billing-blocked, so six workflows were failing **before their first step ran** — the failing jobs report `steps=0`, meaning GitHub never allocated a runner. Every push and PR carried a red status with no signal in it.

This repo is private on the free plan, so it has no branch protection and no required status checks (`repos/.../branches/main/protection` → 403). Removing these checks blocks nothing.

## What changed

`push:` / `pull_request:` triggers commented out behind a `CI-DISABLED` marker in:

- `test-backend.yml`
- `test-frontend-unit.yml`
- `test-docker-compose.yml`
- `playwright.yml`
- `pre-commit.yml`
- `zizmor.yml`

`workflow_dispatch:` is kept in each so they stay listed in the Actions tab and are runnable the moment billing is restored (and because `on:` cannot be empty).

**Nothing is deleted.** Job and step definitions are byte-identical — the only removed lines in the diff are the trigger blocks. Job counts are unchanged (`playwright` 4, `pre-commit` 2).

## Left alone

- `deploy-staging.yml` / `deploy-production.yml` — **self-hosted** runners, not billed. Staging is currently the only green check.
- `bump-pre-commit-hooks.yml` — schedule-only and already gated on `github.repository_owner == 'fastapi'`, so it skips without consuming minutes and never goes red.

## Re-enabling

```bash
grep -rn "CI-DISABLED" .github/workflows/   # find all six
git revert <this commit>                    # or restore all at once
```

`.github/workflows/DISABLED.md` documents the state, the local commands to run in the meantime, and the re-enable steps. `CLAUDE.md`'s CI note is updated to match.

## Verification

- All nine workflow files re-parsed with PyYAML: valid, job counts unchanged, and the six targets now resolve to `on=['workflow_dispatch']` only.
- `prek` pre-commit hooks passed on commit, including `check yaml` and `zizmor`.

Expect **zero** checks on this PR — that is the intended outcome.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
