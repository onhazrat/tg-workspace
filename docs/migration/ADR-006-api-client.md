# ADR-006: API Client Style

**Status:** Accepted

**Decision:** Hand-written `frontend/src/api/` module for all REST + SSE streaming. Template generated OpenAPI client kept for admin/user routes only.

**Rationale:** SSE streams and large telemetry payloads do not fit generated client patterns well.
