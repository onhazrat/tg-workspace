# ADR-002: Authentication

**Status:** Accepted (light auth)

**Decision:** Self-hosted single-operator uses optional `API_KEY` header (`X-API-Key`) plus template JWT for admin routes. ~~Email signup/recovery stripped from production path.~~ Reverse-proxy auth supported as alternative.

⚠️ **The signup/recovery sentence was superseded** — recovery by [ticket 01](../../.scratch/multi-user-tenancy/issues/01-harden-the-auth-flows.md), which made it reachable in production because it was broken there, and signup by [ADR-011](./ADR-011-multi-user-registration.md). The API-key and JWT parts stand.

**Rationale:** Full multi-tenant SaaS not required; API key is simplest for homelab/VPS deployment.
