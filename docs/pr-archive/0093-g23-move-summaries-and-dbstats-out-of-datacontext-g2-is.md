# #93 ♻️ G2.3: move summaries and dbStats out of DataContext — G2 is complete

**State:** merged 2026-08-02 · **Branch:** `g2-final` into `main` · **Diff:** +260 / -110 across 15 files · **Opened:** 2026-08-01

---

**Stacked on #92** → #91 → #90 → … → #84. Final G2 unit.

`useSummariesHistory()` added to `hooks/useSummaries.ts`, new `hooks/useDBStats.ts`. Nine consumers repointed, including `useCommandRegistry` — which builds `CommandContext`, so the non-React command layer keeps its contract unchanged while sourcing these from hooks.

## `DataContext`: 366 → 168 LOC, ~24 fields → 8

What remains is `channels`/`channelStats` and `selectedChannels`/`prevChannelNames`, and they belong together: the selection-reconciling effect (auto-add on a new channel, drop on a vanished one — what `DataContext.test.tsx` covers) reads the channel list to decide. Splitting them would produce a provider whose only job is watching another provider.

The context is now one coherent thing — *the channel list and which of them are selected* — rather than a grab-bag.

## The plan's framing was wrong, and it's worth saying why

The plan said **"11 providers nested 11 deep → ~5"**. Nesting depth costs nothing at runtime. The actual cost was that a provider **held server state**: every consumer of *any* field re-rendered when *any* of them changed, and reaching a value meant threading it through the tree.

All eleven providers remain. `AIContext` (714 LOC) and `ScraperContext` (632) are workflow state and legitimately *are* contexts. What changed is that **no provider is now a proxy for react-query** — which is the thing that was actually wrong. Scored on provider count, this work would read as 0/6.

## G2 across its three units

| | before | after |
|---|---|---|
| `DataContext` LOC | 366 | **168** |
| `DataContext` fields | ~24 | **8** |
| imperative `loadX()` call sites | 17 | **0** |

## Verification

`tsc` clean; biome clean; `bun run build` succeeds; **809 pass / 0 fail** across 110 files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
