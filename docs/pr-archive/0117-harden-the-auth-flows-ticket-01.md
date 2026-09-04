# #117 🔒 Harden the auth flows (ticket 01)

**State:** merged 2026-08-23 · **Branch:** `worktree-ticket-01-harden-auth-flows` into `main` · **Diff:** +1037 / -34 across 16 files · **Opened:** 2026-08-23

---

Closes ticket 01 in `.scratch/multi-user-tenancy/issues/`.

## Why

Four things were wrong with the auth flows, all verified in code before being fixed.

**Forgot-password was unreachable outside `local`.** `/password-recovery/{email}` and
`/reset-password/` are declared on a prefix-less router mounted at `/api/v1`, so
`APIKeyMiddleware`'s `/api/v1/login` exemption never matched them and it answered 401
before routing. Nothing caught it: the whole suite runs with `ENVIRONMENT=local`, the one
setting where that middleware waves everything through.

**The recovery handler defeated its own enumeration hardening.** It returned one uniform
message for known and unknown addresses, then called `send_email` unconditionally — which
opens with `assert settings.emails_enabled`, and `.env.example` ships `SMTP_HOST=` empty.
Unknown address 200, registered address 500: an account oracle assembled out of the code
written to prevent one.

**Nothing counted requests.** A login runs a bcrypt verify, a signup writes a row, a
recovery can send mail, and all three are anonymous by definition.

**The API key was compared with `==`**, which short-circuits at the first differing
character.

## What changed

- **Middleware** (`app/middleware/api_key.py`): public paths split into an exact set and a
  prefix tuple behind one `is_public_path()`. Every prefix now ends at a path separator —
  `/api/v1/password-recovery` without one swallows
  `/password-recovery-html-content/{email}`, the superuser-only route that renders a live
  reset token for any address, and `/api/v1/login` without one would swallow a
  `/login-history` on the day someone adds it. A missing trailing slash is treated as the
  path that has one, because FastAPI's 307 happens in the router, which never runs once
  the middleware has answered 401. `hmac.compare_digest` replaces `==`, encoded to bytes
  first (it raises `TypeError` on non-ASCII `str`, and Starlette decodes headers as
  latin-1, so comparing raw turns one header byte into a 500 anyone can trigger).
- **`/users/signup` is exempt unconditionally** rather than on `USERS_OPEN_REGISTRATION`.
  The handler already answers 403 when registration is closed; one gate deciding policy
  beats two that have to agree, and it removes a settings-dependent branch.
- **Recovery** (`app/api/routes/login.py`): gates on `emails_enabled`, warns the operator
  when mail is unconfigured (a misconfigured SMTP host is now a logged no-op rather than a
  silent one, and the warning deliberately does not name the address), and defers the send
  to `BackgroundTasks` — an inline SMTP send is the same oracle read with a stopwatch, and
  it pins a threadpool worker per anonymous request on a single-worker deployment.
- **Rate limiting** (`compose.yml`): a second Traefik router on the auth paths, 10/min per
  IP bursting to 20. Traefik attaches middlewares per router and never per path, so it
  re-declares the TLS, service and compression the catch-all carries, and takes an
  explicit priority instead of relying on the rule-length tie-break.
- **Docs**: `deployment.md` gains a section with a verification snippet; `CLAUDE.md` gains
  the two-gates rule and two guard-table rows.

## Verification

- Backend suite **1103 passed, 2 skipped**; frontend **846 pass, 0 fail**.
- `mypy --strict`, `ty`, `ruff check`/`format`, `tsc --noEmit`, biome — all clean.
- **22 mutations, every one watched to go red.** One escaped on the first pass and was
  instructive: dropping a trailing slash still returned 401, just from a different gate,
  so those assertions now read the `detail` string (`"Authentication required"` is the
  middleware, `"Not authenticated"` is the route).
- **The Traefik config was verified against a real traefik:3.6**, not just asserted from
  the labels: 20 requests through, then 429, with non-auth paths untouched.

## Left for other tickets, recorded in the ticket file

1. `POST /users/signup` still answers 400-vs-200 by whether an address is registered, so
   it is now the enumeration oracle recovery no longer is. The edge limit slows a walk to
   10 addresses a minute; it does not close it. Belongs with **ticket 25**, which rewrites
   that handler anyway.
2. `/docs`, `/redoc` and `/api/v1/openapi.json` are anonymous in every environment.
   Pre-existing and arguably fine, but never actually decided.
3. Staging bakes `VITE_API_KEY=${API_KEY}` into the frontend image, so the deployment's
   API key is readable by anyone who opens the JS bundle.

Point 3 also **corrects the plan**: `docs/multi-user-tenancy-plan.md` A0 says recovery was
unreachable on staging, but the embedded key was letting it through. The fix stands either
way — a logged-out auth flow must not depend on a build-time secret — and the correction
is recorded in the plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ECprSH6vxMjdY3U9Rnj44m
