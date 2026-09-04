# #171 📝 Record what review changed on ticket 28

**State:** merged 2026-09-03 · **Branch:** `ticket-28-record` into `main` · **Diff:** +33 / -1 across 1 files · **Opened:** 2026-09-03

---

Doc only. The ticket file is the record of what was decided and why, and it stopped at the first merge — it said 25 tests and knew nothing about #170.

Adds what review changed: the four fixes, the pre-count that was **kept on a measurement** (~1s on staging's 4.78M-row corpus, essentially all of it `tg_posts`) rather than on an argument, and the one finding that was wrong on its facts (`TagRun` has both `updated_at` and `updated_at_ms`; they mean different things, and that asymmetry is now asserted).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Nu3cRrr3mhbRqATFjC4RQ3
