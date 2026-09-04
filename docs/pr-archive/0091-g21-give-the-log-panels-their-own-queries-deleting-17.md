# #91 ♻️ G2.1: give the log panels their own queries, deleting 17 imperative reloads

**State:** merged 2026-08-02 · **Branch:** `g2-logs` into `main` · **Diff:** +230 / -223 across 21 files · **Opened:** 2026-08-01

---

**Stacked on #90** → #89 → #88 → #87 → #86 → #85 → #84.

`LogsView` and `BotManagement` own their log queries, as `NetworkTelemetry` already did. `DataContext` loses **11 fields** — five lists, five `loadXLogs` reloads and `logsLoading` — and goes **366 → 269 LOC**.

## The headline is 17 deleted call sites, not the 11 fields

`loadXLogs()` was threaded through `CommandContext` (`lib/commands/types.ts`), `add-channel.ts`'s dep object, `refresh-metadata.ts`, `tor-actions.ts`, `useCommandRegistry`, `useChannelGridActions`, `useSyncJob`/`useFollowJob`'s `Deps`, `ScraperContext`, `SettingsHub`, `SummaryView`, `TorPanel`, `useProxyTesting`, `ChatContext` and `AIContext` — every one of them saying *"I wrote a log, please refresh the panel"*.

A3.1 made the write invalidate, so all of it is redundant. The whole chain is deleted, including the `loadNetworkLogs` field on the command-context contract.

## The `enabled` flip is what unlocked it — and is the thing to protect

While `DataContext` created these queries with `enabled: false`, `invalidateQueries` could only mark them stale — **it does not refetch a disabled query** — so every writer had to refetch by hand. With the panels owning enabled queries, the invalidation is sufficient on its own.

`hooks/useLogs.test.tsx` pins **both halves** of that asymmetry:

- an enabled query refetches on invalidation
- a disabled one does not

Re-disable these and the first test fails, which is the signal the reloads have to come back — rather than the panels silently going stale after a write.

`useLazyTabData`'s prefetch stays: it warms the cache when the tab changes, *before* `LogsView` mounts, which an enabled query cannot do for itself.

## Verification

`tsc` clean; biome clean; `bun run build` succeeds; **809 pass / 0 fail** across 110 files.

## Remaining in G2

`DataContext` still holds `channels`, `channelStats`, `botCredentials`, `chatDestinations`, `summariesHistory`, `dbStats` and their loaders. Only `selectedChannels`/`prevChannelNames` are genuine UI state and should be what it ends up holding.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
