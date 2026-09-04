# #168 🔏 View-as elevation and acted-by (ticket 27)

**State:** merged 2026-09-02 · **Branch:** `ticket-27-view-as-elevation` into `main` · **Diff:** +2247 / -38 across 32 files · **Opened:** 2026-09-02

---

Closes ticket 27. An Owner elevates a View-as session to make a change on somebody's behalf, and the record never claims that person asked for it.

| Checkbox | Where |
|---|---|
| Elevation is explicit, separately recorded, and shorter-lived than the read-only session | `POST /view-as/{id}/elevate`, a second `view_as_sessions` row, a `Settings` validator |
| Elevation is refused when the target is an Admin | `elevate_view_as`, `rbac.permissions_for(target)` is empty |
| Artifacts written during elevation record the acting Owner alongside the User | `acted_by_*` on the four artifact tables, `core/acting_owner.py` |
| The acting Owner is visible in that User's History | `services/artifacts.py` legs, `ArtifactBase.acted_by_email`, `ArtifactCard` |
| A guard covers the refusal and the attribution | `tests/api/test_view_as_elevation.py` |

## Shape

Elevation is a **second exchange**, authorised by the Owner's own token rather than by the read-only session they are in. `get_current_user` already refuses every POST carrying an `act` claim, so a session cannot reach the route that would widen it — self-escalation is impossible by construction rather than by a check that has to be right. The elevated token replaces `view_as_token` in the browser; the Owner's own token is never touched, so exiting is still one `removeItem`.

`minutes` is chosen per exchange (default 5, ceiling 15). A `Settings` validator refuses a deployment whose ceiling is not strictly shorter than the read-only session, which is how "shorter-lived than" holds for every reachable value rather than for the default.

## The Admin refusal names no role

Elevation is refused for a target holding **any** permission. `role == "admin"` is the spelling `CLAUDE.md` forbids — a fourth privileged role added as a row would walk straight past it — and the seeded `user` role holds nothing, so "holds no permission" *is* "is an ordinary User", derived rather than listed. Read-only viewing keeps its narrower rule: looking at an Admin's screen to reproduce their problem is legitimate, writing to their account under their name is not.

## Two refusals survive elevation

The `/view-as` family (ticket 26 handed this here by name: a session that could start another writes an audit row naming the *target* as the Owner who looked) and the `/users/me` credential routes (setting the target's password during an elevation means signing in as them afterwards with no `act` claim and nothing stamped, while every other guard here still passes). Both are inventories with reasons, matched in `view_as_allows`, which stays the one function that answers.

## Why `session.info` and not a `contextvar`

The obvious design — a context variable set by `get_current_user` — does not work, and fails silently. `get_current_user` is a `def`, FastAPI solves sync dependencies through `run_in_threadpool`, and anyio copies the context into the worker thread, so the assignment lands on a copy the endpoint never reads. Every write would have been attributed to nobody. `session.info` is SQLAlchemy's per-Session dict for exactly this, and it is the better fit anyway: attribution follows the unit of work, so a background job that binds nothing correctly stamps `NULL`.

`acted_by_*` is written on **every** artifact write, so a User editing their own row clears an Owner's name off it. The key is `ON DELETE SET NULL` where `user_id` cascades, with the address denormalised beside it — deleting the Owner must leave the target's artifact alone.

## Found on the way

`test_non_null_owners.py` located the cascading owner key with `conname LIKE '%user_id%'` and `.first()`. `acted_by_user_id`'s key matches that pattern too and is deliberately `SET NULL`, so the guard began failing or passing at random against an entirely correct schema. It matches the constrained **column** now.

## What review caught

Three real gaps, all fixed and guarded.

**The ribbon's own button refused itself.** The generated client authenticates every request with `activeToken()`, which is the View-as token whenever a session is live — so `POST /view-as/{id}/elevate`, offered from inside a read-only session, arrived with the read-only token and got the 403. The feature was unreachable from the screen it was built for, and no backend test could see it because every one of them sets its own header. `ownerToken()` is a named exception to `activeToken`, and the interceptor now lets a header the caller set explicitly win.

**An expiring elevated session silently redirected writes to the Owner's own account.** `activeToken` falls back to the Owner's token the moment the View-as one expires — ticket 26's fix for a login loop, and right while a session could only read. Once it can write: an Owner still looking at a ribbon saying "Acting as them" clicks Save a minute past expiry, and a `PUT` with a new id creates the row in the **Owner's** account. The elevated session now ends itself at `exp` by the same path as Exit, with a `visibilitychange` check because a background tab's timers are throttled past the window. Read-only keeps ticket 26's behaviour untouched.

**The importer writes `tg_summaries` and was not stamping.** `DATA_ADMIN` means an elevated session cannot reach it today — it carries the *target's* permissions — but the stamp belongs to the write, not to whoever may currently reach it. Both facts are asserted now, the reachable one behaviourally and the structural one structurally.

Two smaller things went with them: the AST guard matched only `ast.FunctionDef`, so an `async def` write would have joined a module failing nothing; and "an elevated session carries the target's permissions, not the Owner's" is now a guard of its own, because it is the load-bearing reason the refusal inventories can stay this short, and resolving the caller from `act` is the obvious-looking fix a future ticket might reach for.

One finding was a false positive: `deps.py` was reported as unparseable Python 2 `except A, B:` syntax. That is the token-filtering proxy's rendering; `ast.parse` accepts the file.

## Verification

- `tests/api/test_view_as_elevation.py`: 31 tests, all green
- full backend suite: 2106 passed, 3 skipped
- frontend: `tsc --noEmit` clean, biome clean, 900 unit tests green
- migration round-trips (`downgrade -1` then `upgrade head`); autogenerate sees no drift
- verified end to end in a browser: the read-only ribbon offers three lifetimes, elevating repaints it amber, a write during the session lands on the target's account, History renders "Last changed by admin@example.com on your behalf" on that row and nothing on the one the target wrote, and Exit returns the Owner
- **seven mutations applied, all seven went red**, including resolving the caller from `act` rather than `sub` — the change a future ticket is most likely to make on purpose

Design and the decisions behind it: `docs/view-as-elevation-plan.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Khr9FLk2BAEryn2BHVSBoG
