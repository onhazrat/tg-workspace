# #78 ⚡ A1b: assemble the auto-regenerate prompt server-side

**State:** merged 2026-08-01 · **Branch:** `a1b-prompt-scope` into `main` · **Diff:** +293 / -25 across 5 files · **Opened:** 2026-08-01

---

Part of the architecture-simplification programme (`docs/architecture-simplification-plan.md`, workstream A).

## What

`generateBackgroundSummary` fetched **every post in the regenerated window** into the browser, concatenated them with `formatPostsForPrompt`, and posted the whole string back to `/ai/summary/stream`. It now sends a `PromptScope` and lets the backend assemble the block — the same path `handleSummarize` has used since the PromptScope work.

## The plan expected this to be the hard half of A1; it was the easy half

The plan's table said "extend `getPromptPostsInput` to cover the remaining branch", implying auto-regenerate shares the interactive path's scope. It does not, and must not: auto-regenerate deliberately applies **no filters at all** beyond `s.channels` and the shifted window — not the current UI filter state, and not even the saved summary's own `postSearch`. So it needs its own two-field scope, and it has no semantic branch to fall back to.

Three uses of the fetched array moved with it:

| was | now |
|---|---|
| `posts.length === 0` | `POST /data/posts/counts`, summed |
| `posts.length` → `Summary.postCount` | the same count |
| `extractCitedPosts(text, posts)` | `lookupPosts(parseCitationRefs(text))` |

**`AIContext` no longer imports `getPostsByDateRange`.** One caller left: `ScraperContext.getScopedPosts` (A1c).

## A pre-existing asymmetry, characterised not fixed

A regenerated summary copies `postSearch` / `semanticSearchQuery` onto its successor as *metadata* but has never **applied** them when regenerating. Honouring them would be a behaviour change dressed as a refactor, so it is recorded in a code comment instead.

## Tests

`tests/api/test_autoregen_scope_parity.py` (7) pins the substitution: a bare channels+window scope selects the same posts as the old date-range read, and each defaulted scope field (`forwarded`, `media`, `maxPerChannel`, `sort`, `seed`) is a **no-op**.

Mutation-tested — window → 3 fail, cap default → 4, channel scope → 1, forwarded default → 1.

> The first mutation round **passed all 7 while the cap was broken**, because I mutated the `PromptScope` dataclass default rather than `PromptScopeInput`'s. Only the schema default is reachable from the wire, which is the one this path relies on.

## Verified

backend **804 passed / 2 skipped** · frontend **715 pass / 0 fail** · mypy strict clean (128 files) · ruff clean · `tsc` clean · biome clean.

Note CI is billing-blocked (`.github/workflows/DISABLED.md`) — expect no checks; the above was run locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
