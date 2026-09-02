# 27: View-as elevation and acted-by

**What to build:** An Owner can elevate a session to make a change on someone's behalf, and the record never claims that person asked for it.

**Blocked by:** 26

**Status:** done

- [x] Elevation is explicit, separately recorded, and shorter-lived than the read-only session
- [x] Elevation is refused when the target is an Admin
- [x] Artifacts written during elevation record the acting Owner alongside the User
- [x] The acting Owner is visible in that User's History
- [x] A guard covers the refusal and the attribution

## How

`POST /view-as/{user_id}/elevate?minutes=N` is a **second exchange**, authorised
by the Owner's **own** token rather than by the read-only session they are in.
That is the whole escalation story: `get_current_user` already refuses every
POST from an `act`-bearing token, so a session cannot reach the route that would
widen it, and there was no hole to punch in the gate ticket 26 built to have
none. It files its own `view_as_sessions` row — `mode` was a string rather than
a boolean from 26 precisely so this would be a value.

`minutes` is chosen per exchange under `VIEW_AS_ELEVATED_MAX_MINUTES` (15,
default 5), and a `Settings` validator refuses a deployment whose ceiling is not
strictly shorter than the read-only session. That is how "shorter-lived than"
holds for every reachable value rather than for the default.

The Admin refusal names **no role**: elevation is refused for a target holding
any permission at all, which is what "is an ordinary User" derives to given that
the seeded `user` role holds none. It refuses a future auditor role too, which
it should. Read-only viewing keeps its narrower rule — looking at an Admin's
screen is legitimate, writing to their account under their name is not.

Attribution rides `session.info` (`core/acting_owner.py`), stamped on every
write of the four artifact tables. Not a `contextvar`: `get_current_user` is a
`def`, FastAPI solves sync dependencies in a threadpool, and a context set there
lands on a copy the endpoint never reads — every write would have been
attributed to nobody, silently.

Design and the decisions behind it: `docs/view-as-elevation-plan.md`, and the
`CLAUDE.md` line beginning "Elevation is a second exchange".

## Two refusals survive elevation

The `/view-as` family (ticket 26 handed this here by name: a session that could
start another writes an audit row naming the *target* as the Owner who looked)
and the `/users/me` credential routes (setting the target's password during an
elevation means signing in as them afterwards with no `act` claim and no stamp
on anything done next, while every other guard here still passes).

## What this ticket found outside its own scope

**`test_non_null_owners.py` matched a foreign key by its name.** It asked for
the `ON DELETE CASCADE` key on `user_id` with `conname LIKE '%user_id%'` and
`.first()`. `acted_by_user_id`'s key matches that pattern too and is deliberately
`SET NULL`, so the guard began failing or passing at random against a schema
that was entirely correct. It matches the constrained **column** now.

## Left open

The five-minute default is a guess at how long a change takes; nothing measures
it. If Owners consistently re-elevate, the number to look at is
`VIEW_AS_ELEVATED_DEFAULT_MINUTES`, not the ceiling.
