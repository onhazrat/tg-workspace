# AEX-01: Make AI execution own database lifetime

**What to build:** Complete the AI execution refactor for Chat, Tag, model listing, embeddings and translation. An Account waiting for a Provider holds no preparation transaction, and a failed rejection-stamp write cannot hide the Provider's intended error. One execution module owns this ordering for all five operations, with their existing request-driven behavior and wire contracts preserved. Include the caller migration, architecture guards and regression tests in this ticket so the whole change lands and verifies together.

**Blocked by:** None (can start immediately).

**Status:** needs-triage

Parent spec: AI execution owns database lifetime, effort AEX. The parent spec defines the agreed interface, testing seams and exclusions.

- [x] One execution module exposes the five agreed named operations using the existing request and response models. Routes retain authentication and HTTP response construction and delegate preparation and Provider execution. Shared execution machinery stays private.
- [x] The module closes the supplied request Session's preparation transaction on success and refusal, including authentication's reads, before any Provider network work. No route has to remember a separate close-before-Provider rule. Only plain prepared values and the existing Provider adapter leave preparation.
- [x] Chat and Tag finish ownership checks, prompt construction and AI Key resolution before returning their async iterator. An absent or foreign Artifact returns its family's 404 before response headers and invokes no Provider. Their returned stream retains neither the preparation Session nor ORM rows.
- [x] Rejected Account AI Keys are recorded through the existing aggregate in a short internal Session. Successful clearing, deleted credentials and Operator Keys retain their current behavior. If recording fails, cleanup ends its transaction, a separate safe diagnostic is recorded, and the scrubbed Provider error still reaches the stream or model-list response. Neither response nor logs disclose the Key through raw errors or exception chaining.
- [x] Missing Post frames, text order, completion and error frames, and cancellation propagation remain correct. A failed stream never emits its success marker. Chat and Tag retain their current request-driven lifetime without retries or detached execution.
- [x] Covered Post prompts, Account and Operator payment purposes, AI Key ownership checks, View-as authorization and existing attribution remain correct. Model-list caching still constructs a Provider only on a miss, with current catalogue fallback and model defaults preserved. Other request options, copied prompts, handler names and wire shapes remain unchanged.
- [x] The Provider-caller inventory, module-kind inventory and Action-path guard include the moved execution behavior. The execution module is classified as an orchestrator. The payment and Artifact coverage rules remain enforced, and affected test substitution points follow the moved behavior.
- [x] Tests use the agreed existing AI HTTP operations as the primary seam, real task-owned PostgreSQL reads and substituted Providers. Focused tests through the execution module cover only timing or cancellation cases the HTTP seam cannot expose clearly. Every operation proves real preparation happened and its transaction ended before Provider work, including authentication-only preparation and a suspended stream. Preparation refusal is covered too.
- [x] Regression coverage includes pre-header Artifact refusal, successful and failed rejection recording, a real transaction opened by a failed validation write, secret-safe diagnostics, payment, Missing Posts, cancellation, model defaults and catalogue cache hits. Existing behavior checks survive the extraction without adding tests of private forwarding helpers.
- [x] Affected Chat, Tag, model-listing, payment, Artifact coverage, View-as and worker regression tests and required backend type and lint checks pass. Use one test process per task-owned database. Record evidence that removing preparation closure makes the lifetime regression fail, and mutation-check changed architecture guards.
- [x] The change stays within the parent spec. It adds no durable Chat or Tag execution, generic execution framework, dependency, schema migration, frontend change or unrelated Provider-caller migration.

## Comments

- 2026-10-27: implemented on `codex/aex-01-ai-execution` from `2985e8db`.
  The five routes delegate to `services/ai_execution.py`; preparation closes
  before Provider work and rejected-Key recording uses a short internal Session.
  The request Session carries no attribution needed by `record_validation`,
  which updates only the credential stamp and its sync validator.
  Implementation and verification are complete. The ticket awaits integration
  review; no merge is claimed.
- Verification: 31 new HTTP/lifetime cases pass; the earlier focused
  AI, payment and architecture run passed 144 cases. `backend/scripts/lint.sh`
  passes (mypy, ty, Ruff checks and formatting). SDK regeneration leaves the
  generated client unchanged. Standards and Spec reviews found no issues.
- `mutations.json` records six repeatable checks. Run from the repository root
  with a task-owned `TEST_POSTGRES_DB` using
  `python scripts/mutate.py .scratch/ai-execution/mutations.json`.
  All six went red: retained preparation, unsuppressed rejection-write failure,
  omitted module kind, omitted Provider caller, an inline Post read, and an
  Action-path derivation that missed execution.
- Final verification: the full backend suite passed with 4,136 passed and
  3 skipped in 604.84 seconds on `app_test_aex_01_3705`. All applicable commit
  hooks passed. The local knowledge graph was updated. No live Provider calls
  or deployment checks were performed.
