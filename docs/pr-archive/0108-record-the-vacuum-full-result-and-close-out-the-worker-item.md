# #108 📝 Record the VACUUM FULL result and close out the worker item

**State:** merged 2026-08-19 · **Branch:** `docs/vacuum-full-done` into `main` · **Diff:** +27 / -6 across 1 files · **Opened:** 2026-08-19

---

Ran with the operator's explicit go-ahead, since the standing rule is that staging is read-only for me.

| table | rows | heap before | heap after | time |
|---|---:|---:|---:|---:|
| `tg_sync_meta` | 10 | 1,360 kB | **8 kB** | 22 ms |
| `tg_channels` | 2,077 | 19 MB | **1,568 kB** | 95 ms |

Dead tuples zero on both; health check 200 afterwards.

The file size was never really the problem — the scan cost was. `get_sync_meta` selects the whole of `tg_sync_meta` on every call, and that table went from roughly 170 pages to **one**.

`tg_sync_jobs` deliberately untouched: 196,047 rows in 153 MB is real data needing a retention policy, not a vacuum. The 711 rows stranded in `running` become reconcilable at step 2 of `docs/scaling-to-multiple-workers.md`, when a job claim can expire.

Also updates the four-worker section from pending to resolved (#107).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
