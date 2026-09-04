# #68 ✅ B6: declare response models for the five non-data routers

**State:** merged 2026-08-01 · **Branch:** `b6-response-models-remaining` into `main` · **Diff:** +2106 / -310 across 17 files · **Opened:** 2026-08-01

---

Unit `B6` from `docs/architecture-simplification-plan.md` — **23 endpoints** across the five non-`data` routers, done as one unit because they share one property: almost every payload here has **conditional keys**.

**Typed responses: 67/129 → 89/129.**

## Two endpoints gained a schema by *deleting* code

`app/ai/models.py` already declared `CompletionResult` and `EmbeddingResult` as real Pydantic models. `/ai/summary` and `/ai/embeddings` were calling `.model_dump()` on them **purely to satisfy a `-> dict[str, Any]` annotation** — throwing the type away on the way out and rendering the endpoint as `{"additionalProperties": true}`. Returning the model directly is simpler *and* correctly typed.

Worth checking for this pattern before writing any new model.

## `JobsStatusResponse` was deleted, not used

It existed, nothing referenced it, and wiring it up would have shipped two bugs:

1. **It declared five jobs; `JOB_IDS` has six.** A closed model drops what it does not declare, so `discover_probe` — and every job added later — would have silently vanished from `GET /jobs/status`.
2. **Its keys are job ids, not columns**, hence snake_case. Correct (the frontend reads `status.auto_sync?.pauseUntil`), but it meant B5's alias sweep needed three exemptions to describe a model nothing used.

`GET /jobs/status` is now `dict[str, JobStatusEntry]` — the shape it always had, and one where any job in `JOB_IDS` flows through. **`EXEMPT` is empty again.**

## Conditional keys found and left undeclared

| Model | Conditional key | When it appears |
|---|---|---|
| `JobStatusEntry` | `detail` | only when a run reported something |
| `JobStatusEntry` | `pauseUntil` | only on `auto_sync`, only while paused |
| `TorStatusResponse` | `autoSpawned` | only on the Tor-**enabled** branch |
| `TestProxyResponse` | `ip` / `latency` / `error` | success vs failure |

Each would otherwise emit a `null` no client has ever received.

## One deliberate behaviour change

`POST /rag/search` returned a bare `{"results": []}` when the scope resolved to no channels, but `{results, truncated, scanned}` otherwise — so a caller could not read `truncated` unconditionally. **Both branches now return the same key set.**

## Two things caught during the work

**A type error the models found.** `telegramChatId` is an `int`, not a string. Declaring it `str | None` turned `test_telegram_channel_info.py` into a 500 — the existing test caught it immediately.

**A test of mine that broke the suite.** The new `/rag/search` case made a **live Gemini call** whenever a key is configured, closing the event loop under the async tests that followed and surfacing as an unrelated failure in `test_smoke.py::test_ai_embeddings`. I isolated it by restoring `origin/main`'s `ai_routes.py` and watching the error move to my own test. `test_smoke.py::test_rag_search` already skips for exactly this reason; the new test now does too.

> **Rule for later units:** any test touching `/rag/search` or `/ai/*` must skip when `GEMINI_API_KEY` is set.

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **767 passed / 2 skipped** |
| mypy strict | clean, 115 files |
| ruff check / format | clean |
| frontend suite | **686 pass / 0 fail** (×3 runs) |
| `tsc -p tsconfig.build.json` | clean |
| mutation: declare `pauseUntil` | **2 tests fail** |
| mutation: declare `autoSpawned` | **1 test fails** |

`legacy.py` re-exports these handlers, so its eleven annotations were propagated to match. That module is workstream E's to delete; this only keeps it type-consistent.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
