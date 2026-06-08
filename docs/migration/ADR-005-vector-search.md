# ADR-005: Vector Search

**Status:** Accepted

**Decision:** Store embedding vectors as JSON in PostgreSQL; cosine similarity in Python (numpy) for Phase 5. Tag rows with `provider`, `model`, `dimensions`.

**Alternative deferred:** pgvector extension or Qdrant at scale.
