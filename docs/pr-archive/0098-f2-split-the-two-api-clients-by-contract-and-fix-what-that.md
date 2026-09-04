# #98 ♻️ F2: split the two API clients by contract, and fix what that exposed

**State:** merged 2026-08-02 · **Branch:** `f2-client-split` into `main` · **Diff:** +625 / -184 across 19 files · **Opened:** 2026-08-02

---

The last unit in `docs/architecture-simplification-plan.md`. Moves thirteen summarizer calls onto the generated client, deletes the hand-declared server types underneath them, and rewrites ADR-006 with a rationale that survives scrutiny.

## The rule: per call, not per family

A call belongs on the generated client when its response type is **at least as useful** as the hand-written one. Two different things make it worse, and conflating them is what made the original survey wrong:

1. **Open models** (`ConfigDict(extra="allow")`) render as a top-level `[key: string]: unknown`, so every conditional key riding in `extra` arrives as `unknown`.
2. **Closed but all-optional** — OpenAPI cannot express *"has a server-side default, therefore always present in a response"*, so `timestamp: int = 0` emits as `timestamp?: number`. A perfectly closed model still fails to be assignable to a hand-written type that knows the field is there.

So `jobs` ends up with **five generated calls and three hand-written ones**. `JobStatusEntry` stays hand-declared and is the one place where that is an *upgrade*: it declares `pauseUntil`, which the open model can only type `unknown`.

## Two corrections to my own survey

Both are now recorded in the plan so they are not re-derived.

**The grep measurement was wrong in both directions.** The one-liner recommended last session:

```
sed -n "/^export type <T> = {/,/^};/p" types.gen.ts | grep -c "\[key: string\]"
```

also counts index signatures on **nested** fields. It reported `ScrapeChannelResponse` and `PostResponse` as OPEN; both are closed at the top level and merely carry one loose column (`posts`, `media`). The real test is at the type level, and is now a compile-time assertion:

```ts
type IsClosed<T> = string extends keyof T ? false : true
```

**Openness is not the only disqualifier.** `RagSearchResponse` is closed, and the `PostResponse` nested two levels inside it is closed too — but every field on it is optional, so it is not assignable to the frontend `Post`. `ragSearch` stayed hand-written for that reason, not for openness.

## Three live defects the move exposed

Each is a place where a generated type stopped agreeing with a hand-written cast — the argument for generated types, arriving unprompted.

### 1. `GET /api/v1/network/proxy-health` returned 500 whenever a proxy was actually in cooldown

`ProxyHealthResponse.bad_proxies` was declared `list[str]` in B6, but `services/network.get_bad_proxies()` has always returned `{"url", "cooldownRemaining"}` dicts, so `model_validate` raised:

```
ValidationError: badProxies.0
  Input should be a valid string [type=string_type, input_value={'url': ..., 'cooldownRemaining': 42}]
```

Every existing check ran against an **empty list** on a healthy deployment — including B6's own key-set test — so it never surfaced. It would have fired exactly when an operator opened the panel to find out why syncs were failing.

Fixed with a declared `BadProxy` model, plus a test that populates the cooldown map. **Verified to fail against the old model** before being kept.

### 2 & 3. Two unreachable `data.error` branches

`ChannelInfoResponse` and `PublishResponse` are both closed and declare no `error`. The key only ever arrives inside an `HTTPException(400, detail={"error", ...})`, which the `catch` already handles via `parseApiError`. In `services/telegram.ts` it even *led* the failure-message chain, so the fallback everyone actually sees was second in line.

## Two dead wrappers deleted rather than migrated

`scrape` and `resolveStartTime` had **no callers**. Scraping has run through `POST /api/v1/jobs/sync` since the migration, and start times resolve in `jobs/settings.py`. Both routes stay live and backend-used; only the frontend wrappers go.

## The split is now enforced, in both directions

`frontend/src/api/client-split.conform.ts` asserts that every moved model stays **closed**, and — the more useful half — that every model kept hand-written is still **open** (or still non-assignable). Close one server-side and the build breaks, telling whoever did it that the call can now move. That is what keeps a deliberate exception from decaying into a leftover nobody dares touch.

It is a **source file, not a test**, because `tsconfig.build.json` excludes `src/**/*.test.*` — assertions in a test would never be type-checked by `bun run build`. Same reasoning as the existing `types.conform.ts`.

## What moved

`getRuntimeConfig`, `getSyncJobStatus`, `startSyncJob`, `cancelSyncJob`, `healthCheck`, `proxyHealth`, `torIp`, `torRestart`, `torNewIdentity`, `ragStatus`, `ragEmbed`, `channelInfo`, `publish`.

The `api.*` facade kept its signatures, so no consumer changed except where a now-redundant cast could be deleted — nine field casts in `add-channel.ts` and `refresh-metadata.ts` alone. `RuntimeConfig` was the biggest single win: six `Record<string, unknown>` fields are now declared models.

## Verification

- Backend **818 passed / 2 skipped** (`TEST_POSTGRES_DB=app_test_entropy`)
- Frontend **819 pass / 0 fail**
- `tsc -p tsconfig.build.json --noEmit` clean, `bun run build` succeeds
- mypy strict, ruff check + format, `ty`, biome — all clean
- All pre-commit hooks pass, including SDK regeneration

---

**With this merged, the plan's backlog is empty — workstreams A through H are all complete.** The only unscheduled item, `I` (component size outliers), was explicitly deprioritised from the start.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
