# ADR-008: AI Provider Abstraction

**Status:** Accepted

**Decision:** `LLMProvider` protocol in `backend/app/ai/`. Gemini first via `google-genai` Python SDK. Routers depend on protocol only. Model registry via `GET /api/v1/ai/models`.

**Future:** Add `openai.py`, `anthropic.py` without router changes. Re-index embeddings on provider switch.
