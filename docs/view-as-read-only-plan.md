# View as, read-only (ticket 26)

An Owner looks at the app as another User, to reproduce a reported problem,
without being able to change anything.

## Shape

The session **is** a token. `POST /view-as/{user_id}` exchanges an Owner's
ordinary token for a short-lived one whose `sub` is the target account and whose
`act` claim is the acting Owner. Everything downstream — the tenancy seam, the
scoped storage namespace, every list and by-id read — then answers for the
target with no code of its own, which is what "exactly as a given User sees it"
has to mean if it is to be true of routes nobody remembered.

That also settles the ribbon. The spec's own decision: *"The View-as ribbon is
driven by a claim in the token, so it survives a reload without extra state."*
No server round trip, no context, nothing to rehydrate.

## Decisions

**The refusal lives in `get_current_user`, and nowhere else.** Every
authenticated route passes through it, so there is one gate rather than two that
drift — the `/password-recovery` shape this repo has already paid for once. A
middleware would be the second gate; a per-router dependency is a rule somebody
forgets on the ninety-first route.

**Unsafe method, minus a declared read-only allowlist.** Refusing every
non-safe method is the simple rule and it is wrong here: five routes in this API
are reads expressed as POST purely so the channel selection travels in the body,
and they say so in their own docstrings. Refusing them would make View-as unable
to open the Posts tab, which is the screen a reported problem is most often
about. The allowlist is therefore an **inventory**, not a set of special cases:
`test_view_as.py` walks every mutating operation the app mounts and fails on one
that is neither refused nor allowlisted with a reason. A route added next
quarter cannot join the API without somebody answering "does this write?".

**The Owner's own token is never overwritten.** The browser keeps `access_token`
as it was and layers `view_as_token` on top, which `headers()` prefers. Exiting
is one `removeItem`, and a deleted target is the same one `removeItem` — the
Owner cannot be stranded at a login screen, which is checkbox 7. The storage
namespace follows the *active* token, so browser-side preferences are read under
the viewed account rather than the Owner's.

**A deleted target answers with its own detail string.** `isAuthFailure` treats
404 `"User not found"` as a dead session and signs the browser out; a view-as
target that has been deleted must not do that to the Owner. It answers
`"Viewed account no longer exists"`, and the transport drops the view-as token
instead of the session.

**The audit row does not cascade.** Every per-User table in this schema cascades
from `user.id`, and an audit record must not: the interesting case is exactly
the account that was deleted. Both foreign keys are `ON DELETE SET NULL` and
both emails are denormalised at creation, so the record still answers who looked
at whom after either account is gone.

**A fourth model module.** `models.py` is template auth, `models_tg.py` is the
TG domain, `models_rbac.py` is roles. A record of an administrative act is none
of the three, and filing it under the nearest heading would make that module's
stated purpose false — the rule `models_rbac.py` was created under.

**The bootstrap superuser becomes an Owner.** `init_db` granted `admin`, and
only `owner` holds `VIEW_AS`, so without this the ticket ships as code no
deployment can reach. Owner is a strict superset of Admin today, so the change
takes nothing away; the migration promotes existing superusers for the same
reason ticket 07's did.

## Checkboxes

| Checkbox | Where |
|---|---|
| An exchange returns a short-lived session naming both the target and the acting Owner | `POST /view-as/{user_id}`, `security.create_view_as_token` |
| Every write is refused during the session | `deps.get_current_user`, `deps.VIEW_AS_READ_ONLY_PATHS` |
| An unmissable ribbon names the account being viewed and survives a reload | `ViewAsRibbon`, driven by the token claim |
| The session expires on its own | `exp`, `VIEW_AS_TOKEN_EXPIRE_MINUTES` |
| Sessions are recorded with who, whom, and when | `view_as_sessions`, `GET /view-as/sessions` |
| Viewing as another holder of the permission is refused | `start_view_as`, `rbac.has_permission(target, VIEW_AS)` |
| A deleted target produces a clear error and returns the Owner to their own account | `VIEW_AS_TARGET_MISSING_DETAIL`, `api/base.ts` |

## What review caught

Two failures, neither on any checkbox, both in the browser half.

**The ribbon missed the main screen.** It was mounted in `routes/_layout.tsx`,
and `/summarizer` is under `_tg` — a separate branch that renders a bare
`Outlet` and is not wrapped by the shell. So the one screen an Owner spends the
session on had no ribbon. It is at the router root now, and
`--view-as-offset` keeps the row it occupies from pushing the summarizer's last
40px off a `h-svh overflow-hidden` layout.

**Expiry was a login loop.** `activeToken()` returned the stored token whatever
its `exp`. Thirty minutes in, the ribbon was already gone while every request
still carried the dead token; the server answers 401 "Could not validate
credentials", which is not one of the ended-session details, so the transport
cleared the *Owner's* token and left the View-as one behind — and the next sign
-in preferred it again. It now falls back to the Owner's token exactly as
exiting does, and `clearStaleSession` drops both layers.

Three smaller things went with them: a dead `request.state.view_as` write whose
comment named a reader that does not exist, a `vsid` claim nothing read, and a
`list_sessions` filter parameter with no caller.

## Out of scope

Elevation to read-write is ticket 27, and so is the acted-by column on the four
Artifact tables. Nothing here writes as the target, so there is nothing yet to
attribute.
