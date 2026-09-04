# #57 📝 Record the actual commit-signing rule: main, not every commit

**State:** merged 2026-07-31 · **Branch:** `worktree-signing-policy-rule` into `main` · **Diff:** +3 / -1 across 1 files · **Opened:** 2026-07-31

---

## What

Replaces the blanket `Commit signing is required` line in `CLAUDE.md` with the rule that actually holds, and adds the audit command.

## Why

`main` is already 100% verified — but not because commits are signed locally. GitHub signs the squash commit it authors. Checked against the last six PRs:

```
36f6e09  verified=true  committer GitHub <noreply@github.com>  gpgsig -----BEGIN PGP SIGNATURE-----
82c8702  verified=true
74bb01d  verified=true
5d58b1a  verified=true
35b7b19  verified=true
8ca2035  verified=true
```

The old wording made background agents stall on a 1Password biometric prompt for branch commits that never reach `main` anyway — signing gates on the user being physically present, which blocks unattended work.

The one commit on `main` that carries a local SSH signature rather than GitHub's, `8283d49`, got there through a **merge commit** (#48) rather than a squash — which is exactly the case the new rule warns about.

## The rule now

- Every commit on `main` must be signed; branch and `.claude/worktrees/` commits need not be.
- Land PRs with **squash merge only** — merge-commit passes branch commits through as-is, rebase-merge replays them unsigned.
- Committing directly to `main` still signs locally, and a signing failure there is still a blocker to raise.
- Local `git log %G?` is not a usable check (`gpg.ssh.allowedSignersFile` unset); audit via `gh api`.

## Notes

Docs only — no code paths touched. Not done here, available if wanted: an `includeIf "gitdir:**/.git/worktrees/**"` block setting `commit.gpgsign = false`, and `gh repo edit --enable-merge-commit=false --enable-rebase-merge=false` to make squash-only mechanical instead of conventional.

Per repo convention, expect no CI checks on this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
