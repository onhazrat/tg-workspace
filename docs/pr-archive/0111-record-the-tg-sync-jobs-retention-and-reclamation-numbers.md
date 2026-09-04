# #111 📝 Record the tg_sync_jobs retention and reclamation numbers

**State:** merged 2026-08-19 · **Branch:** `docs/sync-job-retention-result` into `main` · **Diff:** +32 / -0 across 1 files · **Opened:** 2026-08-19

---

| | before | after |
|---|---:|---:|
| rows | 187,158 | **11,187** |
| heap | 153 MB | **5,856 kB** |
| total | **871 MB** | **30 MB** |
| stranded `running`/`pending` | 759 | **0** |

Disk 82% → 79%.

Two measurement lessons, both of which caught me out this round:

**`pg_relation_size` is heap only.** I reported this table as 153 MB from it; with the TOASTed `channels` column and indexes it was really 871 MB. Size a table with a JSON column by `pg_total_relation_size`.

**A `VACUUM FULL` is sized by live rows, not by the file.** Reclaiming 871 MB took **395 ms** against my 10–30 s estimate — it copies only live tuples, and 11k rows is nothing. Nearly all of that file was free space, not data to move.

Also records honestly that the batched delete (#110) landed one deploy *after* the unbatched version had already cleared the 176k-row backlog. That run was fine (6 dead tuples), so the batching is insurance against a future backlog rather than something this round proved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
