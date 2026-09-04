# #170 🔍 Review follow-ups on the admin-scoped export

**State:** merged 2026-09-03 · **Branch:** `ticket-28-review-followups` into `main` · **Diff:** +236 / -55 across 7 files · **Opened:** 2026-09-03

---

Five findings from `/code-review high` on #169. Four fixed, one measured and kept.

**Kept: the pre-count.** The finding was that counting every section before streaming turns time-to-first-byte from ~0 into a scan of the largest table. Measured on staging's real corpus of **4.78M posts**: the whole pass is **~1s**, essentially all of it `tg_posts` — 975ms unscoped, 987ms through the follow `EXISTS`, every other table single-digit milliseconds. One second in front of a download that then streams for minutes is the trade ticket 28 asked for, and moving the counts to the end of the document answers a question nobody has by then. The number is now in the docstring so the next reader does not re-derive it.

**Fixed: `X-Export-Rows` was unreadable by the only client there is.** CORS exposes almost nothing by default and the dashboard is on a different host from the API, so the header read back as `null` in `fetch` — a header whose whole purpose is telling a browser how large a download is before it starts. Named in `expose_headers` (not `*`, which is ignored outright when credentials are allowed), and asserted.

**Fixed: the sections were resolved twice per download.** `PreparedExport` is the plan, built once; the route hands it to the streamer instead of a bare counts dict. Guarded by counting the calls, because "it is only two extra queries" is how a per-request cost gets waved through twice.

**Fixed: `updated_at` is stamped only where the column exists.** SQLModel takes that assignment either way and files an unmapped attribute on the instance, so a family added later without the column would read as stamped and be silently unstamped. The review also read `TagRun` as lacking it — it has **both** `updated_at` and `updated_at_ms`, and they mean different things: the millisecond clock is what History renders, so a restored artifact keeps the moment it was made while `updated_at` records this install's write. That asymmetry is now written down and asserted.

**Fixed: a whole-account export no longer round-trips through the tab's heap.** `exportAccountBlob` parsed the response and stringified it again — two or three copies of a document the server streams precisely so it never holds one. It never looks inside, so it takes a Blob.

## Verification

Backend **2161 passed, 3 skipped**; frontend unit 901 passed; mypy, ty, ruff, biome, tsc clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Nu3cRrr3mhbRqATFjC4RQ3
