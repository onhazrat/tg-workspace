# ADR-016: An Artifact is paid for by the Account that asked for it

**Status:** Accepted (2026-09-08). Supersedes the **Future** clause of
[ADR-008](./ADR-008-ai-providers.md), which planned a provider class per vendor and assumed one
AI vendor per deployment.

## Context

Every AI call in the deployment is paid for by one key, `GEMINI_API_KEY`, read from the root
`.env` in `app.core.config.Settings` and used in one place, `GeminiProvider._get_client`. That was
correct while a deployment was one Operator. It is not correct now that registration is a
supported path ([ADR-011](./ADR-011-multi-user-registration.md)) and the tenancy seam is on: an
Account signs up and starts spending the Operator's money, with no ledger to stop it. The Telegram
side of the same problem already has one, `tg_quota_usage`, counting Requests per Account per day.
The AI side has nothing.

So the ask is BYOK, and the obvious shape is "each Account brings a key, every AI call uses it".
That shape is wrong here, and the reason is in the data model rather than in anybody's preference.

**Not all AI output belongs to one Account.** `tg_post_embeddings` is `FOLLOW_SCOPED`, keyed
`{channel_name}_{post_id}`: one vector per Post, shared by every Account that follows the Channel.
It carries `provider`, `model` and `dimensions` as *description*, not as key. Two Accounts on
different embedding Providers therefore overwrite each other with vectors from incompatible
spaces, and Semantic chat then returns plausible nonsense rather than an error. ADR-008 foresaw
half of this — "re-index embeddings on provider switch" — but only for a deployment-wide switch,
which is a migration an Operator runs once, not a thing two Accounts can do to each other
concurrently.

`tg_post_translations` is the same shape for the same reason, and its job is worse:
`run_translation_batch` has no Account at all. It reads deployment settings, selects Posts across
the whole corpus and writes shared rows. There is no Account whose key could plausibly pay for it,
and inventing one raises "whose key translated this row" with no good answer when two Accounts
follow the same Channel.

`/rag/search` is not a choice at all. It embeds the question with the same `EMBEDDING_MODEL` the
corpus was built with, and a query vector from a different Provider lands in a different space.
It is forced onto whichever key built the corpus.

## Decision

**An Artifact is paid for by the Account that asked for it. Everything that is not an Artifact is
paid for by the deployment.**

This reuses the Artifact definition in `CONTEXT.md` unchanged, including the clause that already
does the work: an Artifact is a durable output somebody *deliberately asked for*, which is
precisely what excludes Logs, Sync jobs and Embeddings. Translation and query-embedding fall on
the excluded side by that same clause, without it being widened to reach them.

So: Summary, Chat and Tag run are charged to the requesting Account's **AI Key**. Embeddings,
Translations and the query-embedding inside a Semantic chat are charged to the **Operator Key**.
One Semantic chat therefore spends both keys, and that is correct rather than a wart — the
retrieval reads a shared corpus and the completion is the Account's own output.

An Account with no AI Key cannot create an Artifact. There is **no fallback to the Operator Key**,
and no deployment switch to enable one. A fallback would make the default path the one where the
Operator pays, which is the problem this ADR exists to solve, and a switch would be a second code
path exercised by one deployment.

### The Provider surface

Two Provider kinds, not one per vendor. `GeminiProvider` stays as it is. The second is a single
`OpenAICompatibleProvider` taking a base URL, which reaches OpenAI, OpenRouter, Groq, Together,
DeepSeek, Mistral, Ollama and vLLM without a class each. ADR-008's planned `openai.py` plus
`anthropic.py` plus one file per vendor forever is what this replaces: a curated enum of vendors
cannot mean "any Provider they like", and its model catalogue is stale the week it ships.

The model is **not** stored on the AI Key. One OpenRouter key reaches several hundred models, so a
default-model-per-key would be wrong-shaped for the case that motivates the feature. The model
stays where it already is, on the wire as `body.model` per call. `GET /api/v1/ai/models` survives
from ADR-008 but changes meaning: instead of a static list of three Gemini ids hardcoded in the
backend and again in `frontend/src/constants.ts`, it proxies `GET {base_url}/models` for the
named Key and falls back to free text when a Provider does not serve one.

### Storage

`tg_ai_credentials`, `USER_OWNED`, many rows per Account, modelled on `tg_bot_credentials` down to
the Fernet-encrypted column and the `last_validated` timestamp. It reuses `TOKEN_ENCRYPTION_KEY`
and `core/secrets.py` rather than introducing a second encryption scheme. `services/ai_keys.py` is
its sole writer and is an **aggregate** in the sense `tests/services/test_service_kinds.py` means.

A Key is validated on save with one cheap completion, the way a bot credential is, and a Provider
that later rejects it clears that validation state so the settings surface can say so. Nothing
re-validates on a schedule: a scheduled job that spends people's money to check whether they can
still spend money is the exact cost this ADR is trying to remove.

Keys are never pruned, so they appear on neither retention inventory, and they are **omitted** from
export with a stated reason. An export is a file people email themselves.

### Choosing a Key, including when nobody is watching

The Key is chosen per call, not set as an Account default. `Summary.extra` gains an `aiKeyId`
alongside the `publishBotId` and `publishChatId` already there, and a scheduled regeneration reads
it back exactly as `_auto_publish` reads those.

The security lesson from that neighbour transfers verbatim and is not optional. `extra` is filled
from unknown keys in the request body, so `aiKeyId` is **client-supplied**. Multi-user-tenancy ticket 33 found that
resolving `publishBotId` by primary key alone let a Summary name another Account's credential,
which the scheduler would then decrypt and send with. The AI Key must be re-checked against the
Summary's owner before `decrypt_token`, in the same place and for the same reason.

### The log

`LLMLog` gains `provider` and `base_url` as columns beside the existing `model`, denormalised with
no foreign key so the row stays readable after its Key is deleted — the reasoning `Summary.
acted_by_user_id` already gives. It also gains the `acted_by_user_id`/`acted_by_email` pair, which
it lacks today although all four Artifact families carry it; see
[ADR-017](./ADR-017-spend-session.md) for why that gap matters once an Owner can spend.

Key material is never logged. `full_request` is composed at each call site today rather than being
a dump of the outgoing HTTP request, which is why nothing can capture an auth header now. The
OpenAI-compatible Provider must inherit that, and a guard has to assert it, because the lazy
implementation is "log the body we sent" and Gemini's REST surface accepts the key as a `?key=`
query parameter.

## Why not per-Account embeddings

It is the honest alternative and it was rejected on size. `tg_post_embeddings` is the largest table
in the deployment against a corpus of roughly 4.68M Posts; keying it per Account multiplies it by
the number of Accounts, for vectors that would be near-identical whenever two Accounts happen to
choose the same Provider. The corpus is shared by design. A shared embedding Provider is the
answer that matches it.

This does mean an Account cannot keep its Posts away from the Operator's embedding vendor. If
that ever becomes a requirement, this ADR is the thing to reopen, and per-Account embeddings is
where it goes.

## Consequences

The Operator still pays for something, forever. Embeddings and Translation are corpus-wide and
scale with the corpus rather than with the Accounts, which is the cost profile an Operator can
actually plan against, unlike Artifacts.

A wrong model id or base URL fails at call time, not at save time, because the model is free text
against an arbitrary endpoint. Save-time validation catches the credential and the address but
cannot enumerate what it has not been asked for. A scheduled Summary whose Key was deleted or
revoked fails on its next run, files a failed `LLMLog` row and clears the Key's validation state.
It does **not** disable itself: auto-disabling somebody's schedule because one call returned 429
loses work quietly, and `publish_summary_text` already sets the precedent of filing a failed log
rather than returning silently, because the scheduler is unattended.

`GET /api/v1/ai/models` now makes an outbound call on behalf of an Account, so it needs caching per
Key and it is no longer a candidate for the View-as read-only allowlist.

Two hardcoded model lists disappear, the backend's and `frontend/src/constants.ts:89`. They had
already drifted from each other's purpose and would have drifted further.

## What this does not decide

Whether an Account can see what its Key has spent. `LLMLog` records `tokens` per call and the
Account owns its own rows, so the data is there; no surface reads it that way yet, and no ledger
analogous to `tg_quota_usage` is proposed for AI.

Whether the Operator Key is ever itself an `tg_ai_credentials` row rather than an environment
variable. It stays in the environment here because it is deployment policy, like every other
`Settings` field.

Whether Anthropic gets a Provider class of its own. Under this ADR it does not need one, since it
is reachable through any OpenAI-compatible gateway, but a first-party client is a later call.
