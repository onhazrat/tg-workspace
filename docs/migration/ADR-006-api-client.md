# ADR-006: API Client Style

**Status:** Accepted — **rationale rewritten 2026-08-02 (F2).** The original reason
was wrong; the decision it justified turned out to be right for a different and
narrower reason.

## Decision

Two API clients, split **per call, not per family**:

- **Generated** (`frontend/src/client/`, committed, never hand-edited) — the admin/user
  shell, and every summarizer call whose response type is at least as useful as a
  hand-written one.
- **Hand-written** (`frontend/src/api/`) — everything else: SSE streams, blob
  downloads, and the calls whose generated response type would be a *downgrade*.

`frontend/src/api/client-split.conform.ts` enforces the split at compile time. It is a
source file, not a test, so `bun run build` type-checks it.

## Why not one client

The original rationale — *"SSE streams and large telemetry payloads do not fit generated
client patterns well"* — does not survive contact with the numbers. SSE is 8 endpoints out
of 129, and "large payloads" is not a typing problem at all. A later revision of the plan
proposed a second reason, untyped responses, and that one was **fixed** by workstreams
B1–B6: 104 of 121 responses now carry a `$ref` model.

The real reason is narrower, and it is a property of the *contract*, not the transport.
**Two things make a generated type worse than a hand-written one**, and they are different
problems:

### 1. Open response models

Several models are deliberately open (`model_config = ConfigDict(extra="allow")`) because
they carry **conditional keys**. `TorStatusResponse` has `autoSpawned` only on the
Tor-enabled branch; `JobStatusEntry` has `pauseUntil` only while a pause is active;
`TestProxyResponse` carries `ip`/`latency` on success and `error` on failure.

This is not sloppiness — it is the rule B1 established and `CLAUDE.md` records. Declaring
a conditional key as an optional field makes it serialise as an explicit `null` everywhere
it is absent today, silently changing the wire format for every existing client.

OpenAPI renders an open model as a top-level `[key: string]: unknown`. Everything in
`extra` therefore arrives typed `unknown`, and — worse — an index signature poisons
`Omit<T, K>`, collapsing every named property into it. That is why `types.conform.ts`
exists at all: rebasing all fifteen domain types onto generated ones produced 190 errors,
almost all of that shape.

### 2. Closed, but all-optional

OpenAPI cannot express *"this field has a server-side default, therefore it is always
present in a response."* A column declared `timestamp: int = 0` emits as
`timestamp?: number`. So a perfectly closed model can still fail to be assignable to a
hand-written type that knows the field is always there.

`ragSearch` is the case: `RagSearchResponse` is closed, and the `PostResponse` nested two
levels inside it is closed too — but every field on it is optional, so it is not
assignable to the frontend `Post`. Moving the call would hand callers a value they must
cast back before use.

## Measuring it

Not with grep. The obvious one-liner — counting `[key: string]` inside a type's source
text — also counts index signatures on *nested* fields, and reported `ScrapeChannelResponse`
and `PostResponse` as open when both are closed at the top level and merely carry one loose
column. The real test is at the type level:

```ts
type IsClosed<T> = string extends keyof T ? false : true
```

`string extends keyof T` holds only for a genuine top-level index signature, because a
closed object's `keyof` is a union of string literals.

## Consequences

- **The split is per call.** `jobs` has five generated calls and three hand-written ones,
  because `SyncJobStatusResponse` is closed and `JobStatusEntry` is not. Anyone reaching
  for "move the `network` family" will find half of it should not move.
- **Leaving a call hand-written is a decision, not a leftover.** Each one is asserted to
  still be open (or still non-assignable). Close the model server-side and the build breaks,
  telling you the call can now move.
- **New endpoints should default to closed models and the generated client.** Reach for
  `extra="allow"` only when a key is genuinely conditional, and say so in the model
  docstring — `app/schemas/summaries.py` is the reference.
- **SSE and blobs stay hand-written regardless.** Codegen cannot express a long-lived
  `text/event-stream`, and the generated client parses every response as JSON.

## What F2 changed

Moved onto the generated client: `getRuntimeConfig`, `getSyncJobStatus`, `startSyncJob`,
`cancelSyncJob`, `healthCheck`, `proxyHealth`, `torIp`, `torRestart`, `torNewIdentity`,
`ragStatus`, `ragEmbed`, `channelInfo`, `publish`.

Deleted three hand-declared mirrors of server response shapes — `SyncJobStatus`,
`SyncJobChannelStatus` and `RuntimeConfig` — plus two inline sync-job envelopes.
`RuntimeConfig` alone had six `Record<string, unknown>` fields that are now declared models.
`JobStatusEntry` stays hand-declared, and is the one place where that is an upgrade: it
declares `pauseUntil`, which the open model's generated type can only call `unknown`.

Deleted two dead wrappers, `scrape` and `resolveStartTime` — no callers; both jobs moved
server-side long ago.

Three live defects fell out of the move, each because a generated type stopped agreeing with
a hand-written cast: `GET /network/proxy-health` **500**ed whenever a proxy was actually in
cooldown (`bad_proxies` declared `list[str]`, the service returned dicts), and two
unreachable `data.error` branches were removed from the channel-info and publish paths.
