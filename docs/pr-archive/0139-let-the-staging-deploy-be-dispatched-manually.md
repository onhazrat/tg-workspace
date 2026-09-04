# #139 Let the staging deploy be dispatched manually

**State:** merged 2026-08-26 · **Branch:** `ci-staging-workflow-dispatch` into `main` · **Diff:** +8 / -0 across 1 files · **Opened:** 2026-08-26

---

`deploy-staging.yml` triggered only on `push` to `main`, so the deploy had no recovery path when the push trigger itself was the broken part.

That is exactly what happened today. A **critical GitHub Actions incident** from 15:11Z throttled inbound work, and pushes to `main` stopped creating workflow runs while dispatch kept working:

| Commit | Pushed | Deploy run created |
|---|---|---|
| `773542a` (ticket 30 merge) | 15:28:45Z | none |
| `126c5ce` (empty "re-trigger" commit) | 16:45:36Z | none |
| Zizmor via `workflow_dispatch` | 16:51Z | created, **green** |

Both pushes registered as `PushEvent` and produced no run at all — not queued, not failed, absent — 80 minutes apart. Everything repo-side was verified healthy meanwhile: workflow active, Actions enabled, `staging` environment with zero protection rules, self-hosted runner online and idle with matching labels.

`workflow_dispatch` makes the current `main` deployable on demand without inventing a commit to push. No other change: same `runs-on`, same steps, same secrets.

Needed right now to get ticket 30 (already merged as `773542a`) onto staging.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01RBTWnZzoqsqzjsFFsrJ7WT
