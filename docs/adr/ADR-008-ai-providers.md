# ADR-008: AI Provider Abstraction

**Status:** Accepted. The **Future** clause below is ⚠️ **superseded 2026-09-08 by
[ADR-016](./ADR-016-bring-your-own-key.md)**.

**Decision:** `LLMProvider` protocol in `backend/app/ai/`. Gemini first via `google-genai` Python SDK. Routers depend on protocol only. Model registry via `GET /api/v1/ai/models`.

**Future:** ~~Add `openai.py`, `anthropic.py` without router changes. Re-index embeddings on provider switch.~~ → superseded by ADR-016: a class per vendor is replaced by one `OpenAICompatibleProvider` taking a base URL, and `GET /api/v1/ai/models` proxies the Provider instead of serving a static list. "Re-index on provider switch" assumed one AI vendor per deployment; under BYOK the embedding Provider is fixed to the Operator Key precisely so no Account can trigger that switch.
