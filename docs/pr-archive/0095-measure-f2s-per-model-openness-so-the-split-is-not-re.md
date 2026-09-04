# #95 📝 Measure F2's per-model openness so the split is not re-derived

**State:** merged 2026-08-02 · **Branch:** `f2-closed-models` into `main` · **Diff:** +24 / -0 across 1 files · **Opened:** 2026-08-02

---

Docs-only. Records the per-model index-signature audit that decides F2's scope, plus the one-liner that measures it.

Openness is **per model, not per family**, so the split is finer than "these four files":

| closed (move) | open (leave hand-written) |
|---|---|
| `SyncJobStatusResponse`, `RuntimeConfigResponse`, `RagStatusResponse`, `ChannelInfoResponse`, `PublishResponse`, `TorIpResponse`, `ProxyHealthResponse` | `TorStatusResponse`, `BotInfoResponse` |

Also records what F2 is actually for: `api/jobs.ts` alone hand-declares `JobStatusEntry`, `SyncJobChannelStatus`, `SyncJobStatus` and `RuntimeConfig` — server response shapes retyped by hand, the same drift B7 removed for domain types. The four modules are only 266 LOC of `request<T>()` wrappers; the win is deleting the parallel type declarations underneath them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
