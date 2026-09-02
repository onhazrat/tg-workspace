# 26: View as, read-only

**What to build:** An Owner can look at the app exactly as a given User sees it, to reproduce a reported problem, without being able to change anything.

**Blocked by:** 07, 21

**Status:** done

- [x] An exchange returns a short-lived session naming both the target and the acting Owner
- [x] Every write is refused during the session
- [x] An unmissable ribbon names the account being viewed and survives a reload
- [x] The session expires on its own
- [x] Sessions are recorded with who, whom, and when
- [x] Viewing as another holder of the permission is refused
- [x] A deleted target produces a clear error and returns the Owner to their own account

## How

`POST /view-as/{user_id}` hands back a token whose `sub` is the **target** and
whose `act` claim is the acting Owner. That is what makes "exactly as they see
it" true of the read paths nobody would have audited: the tenancy seam, the
follow scoping and the browser's storage namespace already answer for `sub`.
The ribbon reads the claims straight off the token, which is why it survives a
reload with no state of its own.

The refusal lives in `get_current_user` — one gate, every authenticated route —
and refuses any non-safe method except a declared allowlist of five reads that
are POSTs only because the channel selection travels in the body.
`tests/api/test_view_as.py` walks every mutating operation the app mounts and
fails on one that is neither refused, allowlisted with a reason, nor derived as
authenticating nobody.

Design and the decisions behind it: `docs/view-as-read-only-plan.md`, and the
`CLAUDE.md` section beginning "A View-as session is a token whose subject is
somebody else".

## What review caught

Two browser-side failures that no checkbox reaches, both fixed and guarded: the
ribbon was mounted in the app shell, which does not wrap `/summarizer`; and an
expired session fell through to `clearStaleSession`, which dropped the Owner's
token and left the dead View-as one behind for the next sign-in to prefer. See
`docs/view-as-read-only-plan.md`.

## Two things this ticket changed outside its own scope

**The bootstrap superuser now holds `owner` rather than `admin`.** `VIEW_AS` is
Owner-only, so without it the feature ships as code no deployment can reach.
Migration `d3e4f5a6b7c8` promotes existing superusers.

**`tests/services/test_rbac.py` asserts permissions rather than a role id.**
The old test named `admin` and would have failed on a change that took nothing
away.

## Left for 27 — done

Elevation to read-write, and the acted-by column on the four Artifact tables.
`mode` was already a string rather than a boolean on both the token and the
audit row, so the second value was a value rather than a second field.

The nesting hand-off landed where this said it would. `routes/view_as.py` still
carries no check of its own: elevation turned out to be a *second exchange*
authorised by the Owner's own token, so the read-only gate keeps a session from
reaching either route, and the refusal that widened is in `deps` — one gate,
still. `test_a_view_as_session_cannot_start_another_one` held throughout, and
`test_view_as_elevation.py::test_an_elevated_session_cannot_start_or_elevate_another`
is its elevated twin.
