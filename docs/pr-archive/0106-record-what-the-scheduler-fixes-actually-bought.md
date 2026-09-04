# #106 📝 Record what the scheduler fixes actually bought

**State:** merged 2026-08-19 · **Branch:** `docs/scheduler-db-cost-results` into `main` · **Diff:** +40 / -0 across 1 files · **Opened:** 2026-08-19

---

Measured results for #104 and #105, 16.3-minute window normalised per hour against the 10-hour baseline.

Headline: the stats aggregate went from **413,776 ms/h to 710 ms/h** at an unchanged call rate (219 → 236 calls/h), so the per-call cost really did fall from 1,890 ms to 3.0 ms. Worst single statement stall: **21,361 ms → 30 ms**.

The doc is explicit that only the aggregate row is a controlled comparison — the rest depend on how much sync work happened during the window.

Session scope confirmed itself within minutes: idle-in-transaction connections 24 → 0, `tg_sync_meta` dead tuples 4,743 → 2, `tg_channels` 4,498 → 157.

Still open: four-worker duplication (aggregate ran 4×/minute for a once-a-minute job), pending the deployment-shape decision.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
