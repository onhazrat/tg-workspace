# #88 ♻️ A3.4: move bot credentials and chat destinations off repository.ts

**State:** merged 2026-08-02 · **Branch:** `a3-credentials` into `main` · **Diff:** +256 / -107 across 7 files · **Opened:** 2026-08-01

---

**Stacked on #87** → #86 → #85 → #84.

Fourth A3 family. `repository.ts` **490 → 397 LOC, 28 → 22 exports**; consumer files 22 → 20. New `lib/bots/store.ts`, 3 importing files repointed.

Suppress, not invalidate — same rule as channels and summaries; `BotManagement` writes the `bots` cache through itself.

## `stripToken` is now load-bearing on its own

With the IndexedDB path gone, `stripToken` is the only thing between a regressed server and a bot token sitting in the browser — the client half of the rule that `BotCredentialResponse` is closed and carries only `hasToken`. It is tested in **both** directions:

- a token the server should not have sent is stripped from a **read**
- the token legitimately sent on a **write** is stripped off whatever comes back

Both leak mutations fail the suite.

## Verification

- `tsc` clean; biome clean; `bun run build` succeeds
- **800 pass / 0 fail** across 109 files
- Mutation-tested against **5 mutations, all caught**: read leaks a token, save leaks a token, save invalidates, delete invalidates, chat-destination delete invalidates

## Remaining in A3

posts (7 fns / 12 files), then embeddings/translations/stats/network-settings/migration, then the infrastructure block (`apiWrite`, etag staleness, the `TgProviders` write-fallback toast).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
