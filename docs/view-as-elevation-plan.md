# View-as elevation and acted-by (ticket 27)

An Owner elevates a View-as session to make one change on somebody's behalf,
and the record never claims that person asked for it.

Ticket 26 built the session and made it read-only. This adds the second mode,
the refusals that keep it from being a way to acquire more access, and the
column on the four artifact tables that says who actually wrote the row.

## Shape

`POST /view-as/{user_id}/elevate?minutes=N` is a **second exchange**, and it is
authorised by the Owner's **own** token rather than by the read-only session.
That is the whole escalation story: the read-only gate already refuses a POST
from an `act`-bearing token, so a session cannot elevate itself, and there is no
hole to punch in the gate ticket 26 built to have none. The browser holds both
layers already (`access_token` for the Owner, `view_as_token` for the session),
so the call it has to make is the one it can make.

The elevated token is the same shape as the read-only one with `mode` set to
`elevated`, and it **replaces** `view_as_token` in the browser. It gets its own
`view_as_sessions` row, so the trail distinguishes "looked" from "changed"
without a second table — `mode` was a string rather than a boolean from ticket
26 precisely so this would be a value.

## Decisions

**The lifetime is chosen per elevation, inside a configured ceiling.** A read-
only session is a fixed 30 minutes because "reproduce a reported problem" is
one activity with one shape. An elevation is not: fixing a stuck setting is
thirty seconds and walking somebody's import is ten minutes, and an Owner who
has to re-elevate four times in a row will pick the longest lifetime on offer
every time. So `minutes` is a request parameter bounded by
`VIEW_AS_ELEVATED_MAX_MINUTES` (15), defaulting to
`VIEW_AS_ELEVATED_DEFAULT_MINUTES` (5). A `model_validator` on `Settings`
refuses a deployment whose ceiling is not **strictly shorter** than
`VIEW_AS_TOKEN_EXPIRE_MINUTES`, which is how the ticket's "shorter-lived than
the read-only session" holds for every reachable value rather than for the
default.

**Elevation is refused for a target holding any permission at all — the rule
names no role.** The ticket says "refused when the target is an Admin", and
`if target_role == "admin"` is the one spelling `CLAUDE.md` forbids: a fourth
privileged role added as a row would walk straight past it. The seeded `user`
role holds `permissions=()` and `tests/core/test_permissions.py` already asserts
that the default role holds nothing, so "holds no permission" *is* "is an
ordinary User", derived rather than listed. It is also strictly stronger than
the checkbox: an auditor role holding only `LOGS_READ_ANY` is refused too, and
should be.

Read-only viewing keeps its own, narrower refusal (a target holding `VIEW_AS`).
The two are deliberately different: looking at an Admin's screen to reproduce
their problem is legitimate, and writing to their account under their name is
not.

**Two refusals survive elevation, and they are an inventory with reasons.**

* The whole `/view-as` family. Ticket 26 left `routes/view_as.py` with no
  nesting check on purpose, because the read-only gate made the branch
  unreachable — and said in as many words that ticket 27 is where it stops
  being unreachable. An elevated session that could start another one writes an
  audit row naming the *target* as the Owner who looked, which is the one lie
  this table exists to prevent.
* `PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me`. Without
  this an Owner sets the target's password during a five-minute elevation and
  afterwards signs in as them directly, with no `act` claim, no audit row, and
  no `acted_by` stamp on anything they then do. Every other guard here would
  pass. The refusal is not about trusting the Owner — they can already reset
  any password through `/users/{id}` under their own name, which is the point:
  that act is attributable and this one would not be.

Both are matched in `view_as_allows`, which stays the **one** function that
answers "may this session make this request" — now taking `mode`. A second
predicate somewhere else is how a write gets through while every test passes.

**Attribution rides the `Session`, not a `contextvar`.** The four aggregates
need "who is the acting Owner of the request I am inside" without a `Request`,
and the obvious answer — a context variable set by `get_current_user` — does
not work here and fails *silently*: `get_current_user` is a `def`, FastAPI
solves sync dependencies with `run_in_threadpool`, and anyio copies the context
into the worker thread, so the assignment lands on a copy the endpoint never
sees. Every write would be attributed to nobody, and the guard would have to be
written wrong to pass.

`session.info` is SQLAlchemy's per-Session dict for exactly this, and it is a
better fit than the contextvar would have been even if the contextvar worked:
attribution follows the **unit of work** rather than the thread. `get_current_user`
holds both the token and the `SessionDep`, so the one gate that decides identity
is the one place that binds it. A background job opens its own `Session`, binds
nothing, and correctly stamps `NULL`.

**`acted_by_*` is set on every write, not only on creation.** The column answers
"the last write to this row was made by this Owner on the User's behalf". An
ordinary session binds no acting Owner, so a later edit by the User themselves
clears it back to `NULL` — which is right: the row is theirs again, and a stamp
that survived would claim an Owner touched something they did not.

**`SET NULL` and a denormalised address, like the audit row.** `user_id` on
these four tables cascades, because deleting an account deletes what it owns.
`acted_by_user_id` must not: deleting the *Owner* has to leave the target's
artifact alone, and the record of who wrote it is exactly what a reader wants
afterwards. So the key is `SET NULL` and `acted_by_email` is denormalised —
the same design, and the same reason, as `view_as_sessions`.

**History shows the address, not the id.** `acted_by_email` is a field on
`ArtifactBase`, so it is present for all four kinds and cannot become a
per-kind optional that narrowing tells the compiler nothing about. It is `null`
for the overwhelming majority of rows, which matches `note` and `model` beside
it.

## Checkboxes

| Checkbox | Where |
|---|---|
| Elevation is explicit, separately recorded, and shorter-lived than the read-only session | `POST /view-as/{id}/elevate`, a second `view_as_sessions` row, `Settings` validator |
| Elevation is refused when the target is an Admin | `elevate_view_as`, `rbac.permissions_for(target)` is empty |
| Artifacts written during elevation record the acting Owner alongside the User | `acted_by_user_id`/`acted_by_email` on the four tables, `core/acting_owner.py` |
| The acting Owner is visible in that User's History | `services/artifacts.py` legs, `ArtifactBase.acted_by_email`, `ArtifactCard` |
| A guard covers the refusal and the attribution | `tests/api/test_view_as_elevation.py` |

## Guard

`tests/api/test_view_as_elevation.py` carries both halves.

The **refusal** half asserts the target rule against a privileged target that
is not an Owner (an Admin), against an Owner, and against a plain account that
must succeed — a guard that only tried the Owner would pass on a check that
merely re-used the read-only one.

The **attribution** half is parametrised over the four families for
`test_artifact_tenancy_scoping.py`'s reason: these are four near-copies of one
module, and a fix applied to one of a pair is half a fix. A fifth family added
without a stamp fails `test_every_family_is_covered_by_this_battery` rather
than passing silently because nobody wrote its test. Alongside it, an AST guard
walks the four aggregate modules and fails any function that commits a write to
its own table without stamping — deletes and read-throughs are excused by name,
with a reason.
