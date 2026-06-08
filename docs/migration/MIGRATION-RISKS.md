# Migration Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Telegram HTML changes | High | Golden HTML fixtures in pytest; monitor scrape tests |
| Tor in Docker | High | Optional feature flag; env-only secrets; spike early |
| Hybrid sync stale cache | Medium | ETags/timestamps; explicit cache invalidation on writes |
| Monorepo frontend port | Medium | Keep TG-Summarizer vite/tailwind versions; time-box port |
| SSE streaming latency | Low | Hand-written stream client, not generated OpenAPI |
| Embedding dimension change | Medium | Tag embeddings with provider/model/dimensions |
| Large post payloads to AI | Medium | Temporary in Phase 2; Phase 3 read APIs reduce payload |
