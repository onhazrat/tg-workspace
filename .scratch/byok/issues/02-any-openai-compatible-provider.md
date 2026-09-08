# BYOK-02: Any OpenAI-compatible Provider, and a real model list

**What to build:** An Account can point an AI Key at any OpenAI-compatible endpoint by giving it a
base URL, and then pick from the models that endpoint actually offers rather than from three
hardcoded Gemini ids.

This is what makes "any Provider they like" true. One Provider class reaches OpenRouter, Groq,
Together, DeepSeek, Mistral, a local Ollama and vLLM, because they all speak the same API at
different addresses. There is no class per vendor and there will not be one.

**Blocked by:** BYOK-01.

**Status:** ready-for-agent

## Why the model is not stored on the Key

One OpenRouter Key reaches several hundred models. A default-model-per-Key would be wrong-shaped
for exactly the case that motivates this ticket, so the model stays where it already is, on the
wire per call.

That means the model list has to come from somewhere, and the endpoint that serves it today
serves a static list hardcoded in the backend and hardcoded again in the frontend. Those two had
already drifted in purpose. Both go.

## Acceptance criteria

- [ ] A single `OpenAICompatibleProvider` implements the existing `LLMProvider` protocol and takes a base URL. No class per vendor.
- [ ] An AI Key of that Provider kind carries a base URL; a Gemini Key does not need one.
- [ ] Save-time validation works for the new Provider kind, so a wrong base URL or a rejected credential is caught at the form rather than at Artifact time.
- [ ] The models endpoint proxies `{base_url}/models` for the named Key instead of returning a static list, and its response is cached per Key so a dropdown does not hit the Provider on every render.
- [ ] A Provider that serves no model list falls back to a free-text model id rather than blocking the Account.
- [ ] Both hardcoded model lists are deleted, the backend's and the frontend's.
- [ ] The models endpoint is treated as a spending operation rather than a read, because it now makes an outbound call on an Account's behalf. It does not join the View-as read-only allowlist. The bar stated for that allowlist already refuses a route on exactly these grounds.
- [ ] The new route joins the account-isolation probe.
- [ ] Summary, Chat and Tag run all work against an OpenAI-compatible Key, not only Summary.

## Notes

The Provider classes themselves are integration code against somebody else's API and are not
worth pinning with tests. The seam that matters is which credential they were handed, and ticket
01 covers that. Asserting request-body shapes here would teach the suite a vendor's current
behaviour rather than ours.

A first-party Anthropic Provider is out of scope. Anthropic is reachable through any
OpenAI-compatible gateway, and a native client is a later call.
