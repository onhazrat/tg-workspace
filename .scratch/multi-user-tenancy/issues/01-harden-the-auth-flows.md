# 01: Harden the auth flows

**What to build:** A person who forgot their password can request a reset link on the deployed instance and receive one. The endpoint answers identically whether or not the address has an account. Registration and login are rate limited at the edge.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Password recovery and reset are reachable for a logged-out browser in staging and production
- [ ] With mail unconfigured, a known and an unknown address produce the same response and no error
- [ ] Registration and login are rate limited at the reverse proxy
- [ ] The API key comparison is constant-time
- [ ] A guard asserts every route without an auth dependency is also exempt from the auth middleware, and it has been watched to fail
