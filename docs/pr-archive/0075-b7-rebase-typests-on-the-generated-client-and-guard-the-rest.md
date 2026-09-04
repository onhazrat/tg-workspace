# #75 ♻️ B7: rebase types.ts on the generated client, and guard the rest

**State:** merged 2026-08-01 · **Branch:** `b7-types-mirrors` into `main` · **Diff:** +326 / -112 across 5 files · **Opened:** 2026-08-01

---

Workstream `B7` from `docs/architecture-simplification-plan.md`.

## The plan's premise was wrong, and I measured it

It said: *replace the 24 hand-written domain interfaces with re-exports of generated types.*

That would have **lost information in 22 of 24 cases**, four distinct ways:

| # | Cause | Example |
|---|---|---|
| 1 | **Open models erase field names** — `[key: string]: unknown` | `Channel`'s group-inherited settings, carried in `extra` |
| 2 | **Nested shapes loose on purpose** | `TagRun.applyResult`, `Post.media` are `unknown` server-side |
| 3 | **Client-side augmentations** | `ChannelStats.latestId` is written locally after a sync |
| 4 | **Literal-union narrowing** | 4 log types know `status` is `"success" \| "failed"`; OpenAPI says `string` |

## What shipped instead

- **9 closed generated types are now the base**: `X = XResponse & <local knowledge>`. The server's field set can no longer be hand-maintained — a rename or removal stops the build.
- **6 open ones stay hand-written.** Rebasing them produced **190 errors**, because `Omit<T, K>` over an index signature collapses every named property to `unknown` (`SummaryListItem = Omit<Summary, …>` would degrade every field).
- **`src/types.conform.ts`** guards those six. It's a **source** file, not a test — `tsconfig.build.json` excludes tests, so assertions in a test file would never be type-checked.

## Two bugs in my own guard, both found by mutation-testing it

1. **The first version could not fail.** `never` is assignable to everything, so mapping fields to `true | never` and constraining to `Record<string, true>` always passed — **both mutations went green**. Collecting the offending *keys* is what gives it teeth.
2. **The second flagged everything.** An open model's index signature puts `string` into `keyof`, so `Server[string]` is `unknown` and every comparison fails. `DeclaredKeys<T>` strips it.

## Real findings, recorded in code

Exported as mismatch sets rather than buried in this description — hover one and it names the fields:

- `NetworkLogMismatches`, `LLMLogMismatches` — `status` narrowed from a server `string`
- `PostMismatches`, `ChannelMismatches` — the deliberately loose columns

Enforcing these four is **B7b**, added to the plan.

## Three genuine inaccuracies fixed

`includesQuery` and `resolveFilePath` declared `string | undefined` for values the server sends as `null`. The runtime already coped — **only the types were wrong**. And `PostTranslation.translatedText` is always sent.

`AlwaysSent<T, K>` restores fields a Pydantic default makes *look* optional: `timestamp: int = 0` is non-required in OpenAPI but always serialised.

## Verification

| Check | Result |
|---|---|
| `tsc -p tsconfig.build.json` | clean |
| frontend suite | **695 pass / 0 fail** |
| biome | clean |
| mutation: retype `Summary.timestamp` server-side | fails with ``Type '"timestamp"' does not satisfy the constraint 'never'`` |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
