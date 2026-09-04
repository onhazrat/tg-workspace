# #119 🐛 Stop /utils/test-email/ returning 500 when mail is unconfigured

**State:** merged 2026-08-23 · **Branch:** `worktree-fix-test-email-500` into `main` · **Diff:** +138 / -1 across 3 files · **Opened:** 2026-08-23

---

Found while verifying ticket 07 on staging: `POST /utils/test-email/` returns **500** with `AssertionError: no provided configuration for email variables`.

`send_email` opens with `assert settings.emails_enabled` and `.env.example` ships `SMTP_HOST=` empty, so on a default deployment the call raises and the caller gets a bare 500. On an endpoint whose entire purpose is checking the mail setup, that is the least useful answer available. It now returns 400 naming the two settings to fill in.

## This is the same bug twice

Ticket 01 found it on `POST /password-recovery/{email}`, where it was worse than a crash — an unregistered address returned 200 and a registered one 500, an account oracle assembled out of the code written to prevent one. That fix guarded *that* call site. This one kept crashing, and was still returning 500 in staging afterwards.

So the guard is on the **set** of call sites rather than the site: every caller of `send_email` must check `emails_enabled` in the same function. That is the lesson `channel_photos.py` and `post_thumbnails.py` already taught this codebase — a fix applied to one of a pair is half a fix, and the guard belongs on the pair. Three callers exist; two already checked, one did not.

The check is deliberately coarse: it asks whether `emails_enabled` appears anywhere in the enclosing function, not whether it dominates the call. Precision there needs real flow analysis, and the failure it exists to catch is "nobody thought about it at all", which a mention catches reliably.

## Verification

- Backend **1135 passed, 2 skipped**. `mypy --strict`, `ty`, `ruff` clean.
- Guard watched to fail **four** ways, including with the original bug restored and with ticket 01's recovery guard removed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ECprSH6vxMjdY3U9Rnj44m
