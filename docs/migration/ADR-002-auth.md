# ADR-002: Authentication

**Status:** Accepted (light auth)

**Decision:** Self-hosted single-operator uses optional `API_KEY` header (`X-API-Key`) plus template JWT for admin routes. Email signup/recovery stripped from production path. Reverse-proxy auth supported as alternative.

**Rationale:** Full multi-tenant SaaS not required; API key is simplest for homelab/VPS deployment.
