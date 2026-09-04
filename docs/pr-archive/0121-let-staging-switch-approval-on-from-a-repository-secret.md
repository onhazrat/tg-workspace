# #121 🔧 Let staging switch approval on from a repository secret

**State:** merged 2026-08-23 · **Branch:** `worktree-staging-approval-secret` into `main` · **Diff:** +15 / -0 across 2 files · **Opened:** 2026-08-23

---

`USERS_REQUIRE_APPROVAL` landed with ticket 25, but the staging deploy never passed it through — turning approval on there meant editing the workflow. It is now read from an optional repository secret.

## The `:-false` is load-bearing

An unset secret expands to the empty string. `USERS_REQUIRE_APPROVAL=` is not a boolean, so pydantic raises `ValidationError` and **the backend fails to start** — on every deploy, until someone sets the secret. That is the opposite of what an optional setting should do, so the default is written where the `.env` is generated rather than left to the secret being present.

Verified all four ways before pushing:

| secret | .env line | settings | boots |
|---|---|---|---|
| unset | `USERS_REQUIRE_APPROVAL=false` | `False` | yes |
| empty | `USERS_REQUIRE_APPROVAL=false` | `False` | yes |
| `true` | `USERS_REQUIRE_APPROVAL=true` | `True` | yes |
| `false` | `USERS_REQUIRE_APPROVAL=false` | `False` | yes |

And confirmed the trap is real rather than theoretical: without the default, the unset case produces `USERS_REQUIRE_APPROVAL=` and settings construction raises `ValidationError`.

Documented in `deployment.md` beside the other environment secrets, including that it takes the literal `true`/`false` rather than anything truthy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ECprSH6vxMjdY3U9Rnj44m
