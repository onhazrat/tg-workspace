# #92 ♻️ G2.2: move bot credentials and chat destinations out of DataContext

**State:** merged 2026-08-02 · **Branch:** `g2-rest` into `main` · **Diff:** +146 / -89 across 7 files · **Opened:** 2026-08-01

---

**Stacked on #91** → #90 → … → #84.

New `hooks/useBots.ts` — the same query, the same key and the same write-through setters, reached directly instead of through the provider tree. Four consumers moved (`AIContext`, `HistoryView`, `SummaryView`, `BotManagement`); `QuickMessagePanel` and `DestinationsPanel` already took them as props and are untouched.

`DataContext` **269 → 208 LOC**.

- **`loadBots` was dead** — zero callers. Deleted rather than ported.
- `useBotsQuery` keeps `cleanupLegacyBots()` in its `queryFn`: a one-time migration of the pre-credential `bots` store that rides along because this is the only thing reading bots on startup. It goes with the mirror in **A4**.
- The write-through setters are preserved exactly. `bots/store.ts` deliberately does *not* invalidate on write (A3.4), so these setters are how a save reaches the UI.

## Where `DataContext` stands

**208 LOC, 12 fields** — down from 366 and ~24 across G2.1 + G2.2:

| group | fields | status |
|---|---|---|
| channels | 4 | server data, still to move |
| summaries | 2 | server data, still to move |
| `dbStats` | 2 | server data, entangled with A4's `getDBStats` merge |
| selection | 4 | **genuine UI state — this is what it should end up holding** |

## Verification

`tsc` clean; biome clean; `bun run build` succeeds; **809 pass / 0 fail** across 110 files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
