# Project documentation

| Section | Description |
|---------|-------------|
| **[ideas-log/](ideas-log/)** | Backlog of ideas to pick up in future work sessions (with AI or solo) |
| **[migration/](migration/)** | TG-Summarizer → FastAPI migration ADRs, inventory, and remediation |

## Tooling

| Document | Description |
|----------|-------------|
| [graphify.md](graphify.md) | Codebase knowledge graph — install, build, and query the graph instead of grepping |

## Audits & investigations

| Document | Description |
|----------|-------------|
| [staging-ui-ux-audit.md](staging-ui-ux-audit.md) | UI/UX walkthrough of the staging summarizer dashboard (2026-07-25) — open findings, IDs, root causes, suggested order |
| [migration/PYTHON-314-TEMPLATE-RESYNC.md](migration/PYTHON-314-TEMPLATE-RESYNC.md) | Python 3.14 upgrade + upstream template re-sync (2026-07-26) — what shipped, divergences kept on purpose, and the gotchas (PEP 758, PEP 649, naive `utc_now()`) |
| [discover-probe-queue-plan.md](discover-probe-queue-plan.md) | Moving Discover handle-probing out of a React effect into a server-owned queue (2026-07-30, PR #51) — decisions with the alternatives rejected, plus §5, a prioritised survey of architectural work still outstanding (`bulk_follow` durability, `useSyncQueue`, client/server drift) |
| [architecture-entropy-audit.md](architecture-entropy-audit.md) | Measured audit of code and architecture entropy (2026-07-31) — the two coexisting data architectures, 11 ranked entropy sources, what is load-bearing and must not be "simplified", and §6: whether to adopt the template's generated-client pattern codebase-wide |
| [architecture-simplification-plan.md](architecture-simplification-plan.md) | The refactor backlog derived from that audit (2026-07-31) — target architecture, ~30 independently shippable units across 9 workstreams, sequencing, and re-runnable success metrics |

## Also at repo root

| Document | Description |
|----------|-------------|
| [development.md](../development.md) | Local setup, testing, OpenAPI client generation |
| [deployment.md](../deployment.md) | Production Docker Compose and Traefik |
