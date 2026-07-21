# IDEA-009: Use pgvector for RAG instead of scanning and scoring in Python

| Field | Value |
|-------|-------|
| **Id** | IDEA-009 |
| **Status** | backlog |
| **Added** | 2026-07-21 |
| **Priority** | medium |
| **Area** | backend |

## Problem

RAG search has no vector index. `POST /api/v1/rag/search` selects a capped window of
`tg_post_embeddings` rows, pulls every vector into Python, and computes cosine similarity
in a loop before sorting and truncating to the requested limit.

The Phase 2 remediation
(`docs/architecture-remediation-plan.md`, T2.6) fixed the acute problems around this —
the N+1 post lookup is now a single join, the date filter runs in SQL rather than in
Python after the cap, the scan has a deterministic `ORDER BY`, and truncation is reported
via a `truncated` flag instead of being silent. **It did not fix the underlying design.**

What remains:

- Similarity is still computed over a *window*, not the corpus. `RAG_SCAN_LIMIT_MAX` is
  5000 (`backend/app/core/config.py`); past that many embedded posts, search examines a
  newest-first slice and honestly reports `truncated: true`, but it is still not
  searching everything. Recall silently degrades as the corpus grows.
- Every vector in the window crosses the DB→app boundary and is scored in Python on each
  request. That is CPU and allocation proportional to the scan cap, per search.

## Proposed direction

Adopt `pgvector`:

1. Add the extension and migrate `tg_post_embeddings.vector` from its current JSON column
   to a `vector(N)` column. `N` is fixed per embedding model — check
   `settings.EMBEDDING_MODEL` and the `dimensions` column for the values actually in use;
   a mixed-dimension table needs resolving first.
2. Build an ANN index (`ivfflat` or `hnsw`) on the vector column.
3. Replace the scan-and-score loop with an `ORDER BY vector <=> :query LIMIT :n` query,
   keeping the existing channel-scoping and date predicates in the same `WHERE`.
4. Retire `RAG_SCAN_LIMIT_MAX` and the `truncated`/`scanned` response fields once search
   genuinely covers the corpus — or keep them and always report `truncated: false`, if
   removing response fields is more churn than it is worth.

## Success criteria

- [ ] Search results no longer depend on a scan cap; `truncated` is always false, or the
      concept is gone.
- [ ] Recall verified against the current implementation on a seeded corpus larger than
      `RAG_SCAN_LIMIT_MAX` — the pgvector path must find matches the windowed scan misses.
- [ ] No vectors are materialised in the application process during a search.
- [ ] Search latency measured before and after on a realistic embedded-post count.

## Non-goals

- Not changing the embedding provider or model.
- Not changing what gets embedded (`getPostEmbeddingText` / the enriched media hints).
- Not revisiting the chunking strategy.

## Open questions

- Are all stored vectors the same dimensionality today? A mixed table blocks a single
  typed column and needs a backfill or a per-model table first.
- Is `pgvector` available in the Postgres image the Compose stack and staging use, or does
  the base image need changing?
- `ivfflat` needs a populated table before the index is built and has a `lists` parameter
  to tune; `hnsw` is simpler to operate but slower to build. Which suits a corpus that
  grows continuously via scraping?

## References

- `docs/architecture-remediation-plan.md` — T2.6, which explicitly defers this
- `backend/app/api/routes/rag.py` — current scan-and-score implementation
- `backend/app/core/config.py` — `RAG_SCAN_LIMIT_MAX`, `RAG_SEARCH_LIMIT_DEFAULT`
- `backend/tests/api/test_rag_search_scan.py` — pins the current semantics; a pgvector
  migration must keep these passing or consciously update them

## Session log

| Date | Notes |
|------|-------|
| 2026-07-21 | Filed while implementing Phase 2 of the architecture remediation plan |
