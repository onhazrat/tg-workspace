# #84 ♻️ F1b: swap legacy/axios for the fetch transport, and fix a logout bug

**State:** merged 2026-08-02 · **Branch:** `f1b-fetch-transport` into `main` · **Diff:** +9265 / -2996 across 46 files · **Opened:** 2026-08-01

---

Replaces the `legacy/axios` codegen plugin with `@hey-api/client-fetch`, deleting **573 lines** of hand-rolled transport (`src/client/core/`) in favour of the maintained runtime, and drops the `axios` dependency. Bundle **2200 KB → 2152 KB** across the same 25 chunks.

## Two generator options carry the whole unit

`@hey-api/client-fetch` resolves to `{data, error, response}` and never throws. Left at that default it would not merely have changed 16 call sites — it would have **silently broken every react-query `queryFn`**, since react-query decides a query failed by the promise rejecting, so each failure would have read as a successful query returning `undefined`.

- `throwOnError` goes on the **client** plugin — that is what flips the generated `ThrowOnError` type-parameter default. Setting it on `@hey-api/sdk` is silently accepted and does nothing.
- `responseStyle: "data"` goes on the **sdk** plugin, and has to be a *generator* option rather than a runtime one: the runtime honours a client-level value, but the SDK only threads the matching type parameter when the generator emits it per call, so setting it at runtime alone leaves the types describing a shape the functions no longer return.

Together they restore the `legacy/axios` contract exactly: resolve to the payload, throw on failure.

## It found a live logout bug

`main.tsx` cleared a stale session from a `QueryCache`/`MutationCache` `onError` reading `error instanceof ApiError ? error.status : 401`. Only the *generated* client threw an `ApiError`. Every hand-written `api/` call — which is what `useChannels`, `useDiscover` and `usePostsView` run inside react-query — throws a plain `Error`, so **every** failure took the `401` branch: a 500 on any summarizer query logged the operator out mid-session.

`ApiError` now lives in `api/base.ts` and carries a real status for both clients, which detect auth failure at the transport. The global `onError` is **deleted** rather than fixed — with the status available at the throw site there is nothing left for it to do.

`@hey-api/client-fetch` throws the *parsed body* (a plain object, no status, not an `Error`). `api/generated-client.ts` recombines body and `Response` in an error interceptor — the only place holding both.

## Also in here

`tests/utils/privateApi.ts` imported `OpenAPI` and `PrivateService` from the generated client, but the spec is exported with `ENVIRONMENT=production` on purpose, so `/private` is absent and that symbol can never exist. It threw at module load and took `admin.spec.ts` and `items.spec.ts` down with it. Now a bare `fetch` — the only form correct however the spec is generated.

## Verification

- `tsc` clean; biome clean; `bun run build` succeeds; the client regenerates byte-identically
- **758 pass / 0 fail** across 105 files (744/103 before)
- 12 transport tests **mutation-tested against 8 mutations**, all caught: client stops throwing, `{data}` envelope returns, auth handling removed, every failure logs out (the pre-F1b bug), raw body thrown, status not carried, `detail` not extracted, request interceptor removed
- **e2e: 59 pass / 3 fail** across `login`, `sign-up`, `reset-password`, `user-settings`, `admin`, `items`. The same 3 fail **identically on pre-F1b `origin/main`** (verified in a throwaway worktree at `d541278`) — two edit dialogs that time out clicking Save with *"element is not stable … detached from the DOM"* so no request is ever sent, plus a pure-`localStorage` theme test.

> One mutation was badly formed on the first attempt and reported a false pass: `usersDeleteUserMe`, `usersReadUserMe` and `usersUpdateUserMe` all share the URL `/api/v1/users/me`, so a URL-anchored patch hit the wrong function. Third unit running where mutation testing caught something a green suite did not.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
