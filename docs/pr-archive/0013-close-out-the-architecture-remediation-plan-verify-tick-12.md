# #13 Close out the architecture-remediation plan (verify + tick §12)

**State:** merged 2026-07-22 · **Branch:** `remediation-final-checklist` into `main` · **Diff:** +88 / -16 across 2 files · **Opened:** 2026-07-22

---

Docs-only. No code changes — the remediation work itself landed in PRs #10, #11 and #12.

This re-verifies every acceptance box in `docs/architecture-remediation-plan.md` §12 against merged `main` and ticks them, by running each command or reading the code rather than trusting commit messages.

## What the audit actually found

Two boxes could not be ticked as literally worded. Rather than tick them anyway, the exceptions are now documented:

**Unbounded `GET`s.** Besides the deliberately-streamed `/data/export`, `GET /data/channels` still returns the whole channel table. That is intentional: T4.3 was closed by measurement (780 channels ≈ 135 kB, client-cached), not by paging. Four small operator-config endpoints (`sync-meta`, `setting-groups`, `bot-credentials`, `chat-destinations`) are the same shape. Everything whose row count tracks post volume *is* paginated.

**`.all()` in services.** 35 surviving hits, each classified by *why* it is bounded — LIMIT/OFFSET, caller-supplied `IN` list, `GROUP BY` (one row per channel), the channel table, a config table, or a boolean flag. The point is that a future reader can distinguish a safe hit from a regression without re-deriving the whole audit.

Also recorded the one frontend timer that is global by design (`App.tsx` auto-sync-pause poll, app shell, gated on `!isOffline`) so it does not read as a missed T1.x, and marked the plan header COMPLETE while keeping the body in its original present tense as a record of the pre-work state.

Phase 6 was already complete in `b4ec5cd` (T6.1 `useCachePrune`, T6.2 `shared-ticker`, T6.3 doc corrections, T6.4 IDEA-009/IDEA-010) — verified, not re-done.

## Verification

- backend `pytest tests/ -q` — **500 passed, 1 skipped**
- frontend `bun test src` — **472 passed**; `tsc`, `biome`, `test:tg-ui` clean
- `playwright test tests/summarizer.spec.ts` — **51/51**, against a `:8000` backend rebuilt from this branch (the default container is the main checkout's image and 404s on endpoints this work added — see `docs/e2e-playwright-guide.md` §4). Main container restored afterwards, health 200.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
