# 01: Harden the auth flows

**What to build:** A person who forgot their password can request a reset link on the deployed instance and receive one. The endpoint answers identically whether or not the address has an account. Registration and login are rate limited at the edge.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Password recovery and reset are reachable for a logged-out browser in staging and production
- [x] With mail unconfigured, a known and an unknown address produce the same response and no error
- [x] Registration and login are rate limited at the reverse proxy
- [x] The API key comparison is constant-time
- [x] A guard asserts every route without an auth dependency is also exempt from the auth middleware, and it has been watched to fail

## What shipped

- `app/middleware/api_key.py` — public paths split into an exact set and a prefix
  tuple behind one `is_public_path()`, with `/api/v1/reset-password/` and
  `/api/v1/password-recovery/` added. The trailing slash on the recovery prefix
  keeps the superuser-only `/password-recovery-html-content/{email}` out.
  `/users/signup` is now exempt unconditionally rather than on
  `USERS_OPEN_REGISTRATION`: the handler already answers 403 when registration is
  closed, and one gate deciding policy beats two that have to agree.
  `hmac.compare_digest` replaces `==` on the API key.
- `app/api/routes/login.py` — recovery gates on `settings.emails_enabled` before
  sending, so an unconfigured SMTP host no longer turns the uniform response into
  200-for-unknown / 500-for-known.
- `compose.yml` — a second Traefik router on the auth paths chaining a
  `ratelimit` middleware (10/min, burst 20, per client IP) plus the existing
  compression, with an explicit service and priority.
- `frontend/src/routes/recover-password.tsx` — the success toast no longer claims
  an email was sent, which the page cannot know.

Guards: `tests/api/test_public_route_exemptions.py` (both directions),
`tests/api/test_auth_middleware.py`, `tests/api/test_password_recovery.py`,
`tests/deployment/test_edge_rate_limit.py`. All fifteen mutations watched to
fail.

## Found while doing this, deliberately left for other tickets

1. **`POST /users/signup` is the enumeration oracle that recovery no longer is.**
   It answers 400 "The user with this email already exists in the system" for a
   registered address and 200 for an unregistered one, unauthenticated, with
   `USERS_OPEN_REGISTRATION` defaulting to true. The edge limit slows a walk to
   10 addresses a minute; it does not close it. Belongs with **ticket 25**
   (open registration and approval), which is rewriting that handler anyway.
2. **`/docs`, `/redoc` and `/api/v1/openapi.json` are anonymous in every
   environment.** `app/main.py` builds the app with docs enabled unconditionally
   and the middleware exempts all three, so staging and production serve an
   interactive schema to anyone. Pre-existing and arguably fine for this project,
   but it has never been decided — noted in `deployment.md`.
3. **`VITE_API_KEY` puts the deployment's API key in a public JS bundle** — see
   below.

## One correction to the plan's premise

`docs/multi-user-tenancy-plan.md` A0 says forgot-password is unreachable in
staging. It is unreachable *on the documented configuration*, but staging bakes
`VITE_API_KEY=${API_KEY}` into the frontend image
(`.github/workflows/deploy-staging.yml:78`), and the generated client attaches it
to every request, so the middleware was letting recovery through on the API key.

That is worth its own ticket rather than a footnote here: it means the deployment's
`API_KEY` is readable by anyone who opens the JavaScript bundle, and the second
auth gate is only as strong as a published string. It does not change this
ticket's fix — a logged-out auth flow must not depend on a build-time secret —
but it does mean the "fail-closed second gate" in `CLAUDE.md` is, on staging,
open to anyone who looks.
