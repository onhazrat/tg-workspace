# Spec: AI execution owns database lifetime

Status: ready-for-agent

Date: 2026-10-27

Effort prefix: AEX

Source reviewed at local commit `df57a47472bca0f9761bba5cbda615a34cc01554`.

Vocabulary comes from the repository's glossary. This spec preserves the payment rule in ADR-016, View-as spending and attribution in ADR-017, Summary Attempts on the worker in ADR-030, and Covered Post prompt behavior in ADR-038.

## Problem statement

An Account waiting for a Provider's response can leave a database transaction open for the whole wait. Authentication already reads through the request Session. Chat and Tag then read their Artifact and prompt inputs, model listing resolves an AI Key, and even embeddings and translation retain authentication's transaction while they await their Operator-paid Provider work.

The request needs those database reads to prepare its work. It does not need the preparation transaction while the Provider answers. Keeping it open holds database resources and can interfere with database maintenance. This is a source-confirmed lifetime defect; its effect on deployed performance has not been measured.

The ordering knowledge is spread across five routes. Adding a close call to each route would repair today's defect while leaving future callers responsible for remembering the same rule. Chat and Tag's shared stream framer also accepts the preparation Session because it may record a rejected AI Key later.

An Account can lose the useful error message as well. If a Provider rejects an AI Key and the database write clearing its validation stamp fails, that second failure currently prevents the intended stream error frame or model-list rejection response.

## Solution

One AI execution module owns preparation, transaction release and Provider execution for Chat, Tag, model listing, embeddings and translation. Each route delegates a named operation. The module finishes its database preparation before waiting for a Provider and owns any short database write needed afterward.

Accounts keep the same prompts, payment rules, stream frames and responses. A rejected AI Key still produces the intended error when recording its validation state fails. Chat and Tag keep their current request-driven lifetime; this work does not make them survive a browser disconnect.

## User stories

1. As an Account using Chat, I want the database work that prepares my turn to finish before the Provider answers, so that a slow answer does not retain its preparation transaction.
2. As an Account generating a Tag run, I want its preparation transaction released before streaming, so that the Provider's response time does not determine the transaction's lifetime.
3. As an Account listing a Provider's models, I want preparation released before the catalogue request, so that a slow catalogue does not hold the authentication transaction open.
4. As an Operator paying for embeddings, I want the endpoint's authentication transaction released before embedding work, so that shared work does not retain an unrelated read transaction.
5. As an Operator paying for translation, I want preparation released before the Provider translates, so that a long batch does not hold database resources for its entire duration.
6. As an Account, I want Chat and Tag run prompts to keep reading their Artifact's Covered Posts, so that moving execution does not change what the Artifact describes.
7. As an Account opening an absent or foreign Artifact, I want its existing 404 before streaming begins, so that the response remains a refusal and spends no AI Key.
8. As an Account naming an AI Key, I want ownership checked before decryption, so that another Account's credential cannot pay for my request.
9. As an Account using Chat, Tag or model listing, I want the current Account-paid rule preserved, so that moving execution cannot silently charge the Operator Key.
10. As an Operator, I want embeddings and translation to retain their existing Operator Key purposes, so that shared corpus work keeps its current payment rule.
11. As an Account whose Covered Posts include Missing Posts, I want the stream's initial count preserved, so that I still know what its prompt left out.
12. As an Account reading streamed text, I want its existing chunk order and successful completion marker, so that the browser continues to interpret the response correctly.
13. As an Account whose Provider fails after producing text, I want the scrubbed error frame without a success marker, so that a partial answer never appears complete.
14. As an Account whose AI Key is rejected, I want its validation stamp cleared when the database write succeeds, so that the Settings view reflects the rejection.
15. As an Account whose Provider rejects an AI Key during a database write failure, I want the original Provider error preserved, so that the secondary failure does not hide the reason my request failed.
16. As an Account whose AI Key was deleted while a Provider was answering, I want rejection recording to handle the missing row safely, so that a missing stamp cannot replace the intended response.
17. As an Account, I want AI Key material absent from responses and logs, so that a secondary database error cannot disclose a credential through an exception chain.
18. As an Account opening a cached model catalogue, I want the cache reused without constructing another Provider, so that the refactor preserves the existing catalogue behavior.
19. As an Account using a Provider with no catalogue, I want the current free-text fallback, so that the refactor does not block a Provider I could use before.
20. As an Account, I want the current model choices, default-model rules and request options preserved, so that moving execution does not change the work I asked for.
21. As an Owner using an authorized Spend session, I want the target Account's permissions, payment and existing attribution preserved, so that session release does not change who may act or who pays.
22. As an Account whose preparation fails, I want the preparation transaction released and the existing refusal returned before Provider work, so that a failed prompt cannot leave resources held or spend a Key.
23. As an Operator diagnosing a failed validation write, I want a separate safe diagnostic, so that I can see the database failure without replacing the Account's Provider error.
24. As a maintainer adding an AI caller, I want transaction timing owned by the execution module, so that the route does not need to reconstruct its ordering rules.
25. As a maintainer, I want regression tests that perform real preparation reads and observe transaction release at Provider invocation, so that an empty fake setup cannot pass while proving nothing.
26. As a maintainer, I want route contracts and copied-prompt behavior preserved, so that this backend refactor requires no browser or generated-client change.

## Implementation decisions

1. **Scope.** The execution module covers exactly the five Provider-calling operations already discussed: Chat streaming, Tag streaming, model listing, embeddings and translation. Copied Summary and Tag prompt reads remain available through their existing routes.
2. **One module interface.** Expose five named operations using the existing request and response models. Use ordinary functions returning async iterators for Chat and Tag, and asynchronous functions for the three one-shot operations. Routes retain authentication dependencies and HTTP response construction.
3. **Eager stream preparation.** Chat and Tag complete ownership checks, prompt construction, AI Key resolution and preparation release before returning their iterator. An absent or foreign Artifact must produce its family's 404 before HTTP response headers are sent. An async generator entry point that defers those checks would change pre-stream refusals and is not the agreed interface.
4. **Transaction ownership.** The execution module consumes the supplied request Session, including authentication's open transaction. One private preparation context closes it on both success and failure. Callers pass the Account id as a plain value and do not read ORM rows after handing over preparation. No route retains a separate close-before-Provider obligation.
5. **Plain execution inputs.** Only plain prepared values and the existing Provider adapter leave preparation. One-shot operations leave the preparation context before their Provider await. The returned Chat and Tag stream carries neither the preparation Session nor ORM rows.
6. **Existing payment and prompt modules.** AI Key resolution remains the single payment rule. Artifact prompt readers retain Covered Post behavior, limits and Account settings. The execution module coordinates their ordering rather than reimplementing them. Chat and Tag read the Artifact before resolving a Key.
7. **Short rejection writes.** Classify rejection using the existing rule. Record an Account AI Key's rejected state through its existing aggregate in a short Session owned inside execution. Handle a deleted credential as today and skip recording for the Operator Key. Preserve any attribution context required by the existing writes without adding a public execution-context type.
8. **Secondary failure policy.** Rejection recording is best-effort. End its failed transaction and log a safe diagnostic without raw exception text or a chained Provider traceback. The intended scrubbed Provider response wins even when saving its stamp fails. Model listing retains its existing rejected-Key response in that case. The prior validation stamp may remain if the write fails.
9. **Stream contract.** Preserve the initial Missing Post frame, text frames, success marker on clean completion, and an error frame without a success marker after failure. Preserve cancellation propagation and the existing request-driven execution lifetime. Add no retry loop or detached task.
10. **Model catalogue.** Resolve the Account's AI Key during preparation, then use the existing cached catalogue path after release. Construct a Provider only on a cache miss. Preserve the current empty-catalogue fallback and default-model selection.
11. **Other defaults and responses.** Preserve selected models, temperatures, prompt instructions, history, translation language and embedding results. Handler names, request bodies, response annotations, permission checks and wire shapes stay the same.
12. **Guarded integration.** Classify the execution module as an orchestrator. Update the declared Provider-caller inventory for the moved calls, keeping its requirement to resolve payment purposes. Include the new module in the Action-path guard's minimum inventory so prompt reads remain governed by Artifact coverage.
13. **Depth.** The module hides preparation and failure ordering behind one interface. Locality puts transaction timing and rejection handling together; leverage reaches all five callers through the existing Provider adapter seam. Its deletion would move those obligations back into the routes.
14. **Rejected shapes.** Five route-owned close calls leave the ordering rule with callers. A generic operation dispatcher or public execution protocols add descriptors and result modes for five known operations. A per-request execution object adds construction and state without a current reuse case. Keep shared machinery private.

## Testing decisions

A good test exercises an agreed interface and asserts an observable response or lifetime property. It performs real authentication and preparation reads, then observes the preparation transaction at the Provider seam. It does not pass merely because a fake skipped the database, nor assert which private helper happened to run.

- **Primary seam: the existing five AI HTTP operations.** Use a task-owned PostgreSQL database and substituted Provider adapters. Exercise authentication, ownership, preparation and execution together. Retain existing Chat, Tag and model-listing HTTP coverage for request bodies, pre-stream refusals, Missing Posts, completion and error frames, catalogue fallback and defaults.
- **Focused execution-module seam.** Test its named operations directly only where the HTTP seam cannot expose a timing or cancellation property clearly. Prefer the existing Provider substitution seam; avoid a public operation registry or additional dependency interfaces solely for tests. Update existing fake-provider setup when private behavior moves out of the routes.
- **Lifetime regression.** Cover every operation. Prove preparation issued real reads, and its transaction ended before the first Provider operation, including authentication-only reads for embeddings and translation. Keep a stream suspended and verify that its preparation transaction remains ended. Also cover preparation refusal. Prior art is the Summary Attempt watch-route test and the auto-sync preparation tests that record transaction begin and end events.
- **Refusal ordering.** An absent or foreign Chat or Tag run returns its family's 404 before a stream response starts and invokes no Provider. Preserve AI Key ownership checks and payment classification through existing payment-rule tests.
- **Rejection recording.** Cover successful stamp clearing, a deleted credential and the Operator Key. Combine a Provider rejection with a failed validation write that has opened a real transaction. Assert the intended stream error or model-list rejection survives, cleanup releases the failed transaction, the separate diagnostic exists, and no success marker or AI Key material leaks into the response or logs. Include an exception chain that would disclose the Key if logged raw.
- **Provider and catalogue behavior.** Verify the model cache avoids Provider construction on a hit, current defaults survive, a Provider without a catalogue retains its fallback, and cancellation propagates without a retry or detached execution. Preserve the existing behavior of the two Provider adapters.
- **Existing checks.** Run the affected stream, Tag, model-listing, payment, Artifact coverage, View-as and worker regression tests, plus the backend's required type and lint checks. Use one test process per task-owned database. Retain the route and module guards.
- **Mutation evidence.** Demonstrate that restoring a preparation transaction across Provider work makes the lifetime regression fail. Mutation-check changed architecture guards and record the evidence with the implementation.

## Out of scope

- Execution that survives Chat or Tag browser disconnects, durable Attempts for those operations, background queues or detached tasks.
- Changes to Summary Attempt execution, retries, scheduling or worker concurrency.
- Generic execution frameworks, public operation registries, new Provider abstractions or new dependencies.
- New retry policies, consent rules, spending rules or AI Key selection policies.
- Changes to the Provider-calling paths in Semantic retrieval, corpus jobs or credential validation outside the five agreed operations.
- New frontend behavior, route shapes, generated client changes, database schema changes or migrations.
- The Command Settings and Directory All matching candidates from the architecture review.
- A new glossary term or ADR for applying the existing transaction rule.
- Performance targets or claims about deployed pool pressure and database maintenance without measurement.

## Further notes

- The existing AI Key save route already prepares plain values, closes its Session, awaits a Provider and performs a short validation write afterward. The Summary Attempt watch route already ends its ownership-read transaction before streaming. Preserve those precedents without expanding this refactor to them.
- Closing the installed SQLModel Session ends its transaction, releases its connection and retains its information dictionary. It permits later reuse, but the chosen stream interface avoids retaining that preparation Session and owns rejection writes separately.
- Function-scoped request dependencies cannot end a transaction before an await inside an async handler; they finish after the handler returns. They do not solve all five operations' lifetime contract.
- The glossary's Attempt remains specific to Summary generation. Chat and Tag retain their existing lifetime and terminology.
- Source, guards and existing tests were inspected. A database-free Session check ran during design. Application tests, load measurements and production checks have not run, and this spec does not claim otherwise.
- Publishing this ready-for-agent spec records the design. Implementation and ticket creation remain separate steps.
