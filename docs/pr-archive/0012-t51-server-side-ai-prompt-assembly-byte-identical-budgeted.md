# #12 T5.1: server-side AI prompt assembly (byte-identical + budgeted); close T4.3

**State:** merged 2026-07-22 · **Branch:** `remediation-t4.3-t5.1` into `main` · **Diff:** +997 / -62 across 17 files · **Opened:** 2026-07-22

---

Completes the architecture-remediation plan: **T5.1** (move AI prompt assembly server-side) and **T4.3** (closed by measurement).

## T5.1 — backend assembles the prompt from a scope
Summary/chat/tag posts used to cross the wire twice (down as JSON for the browser to format, up as a giant `postsText`). Now, for the ordinary path, the frontend sends only the **scope** (channels + date range + Posts-tab filters + per-channel cap + sort) and the backend assembles the posts block itself.

**Backend**
- `format_posts_for_prompt` + `format_posts_for_tag_prompt` ported from the frontend, **byte-identical** (golden parity tests both sides run).
- The AI endpoints accept an optional `scope`; `assemble_posts_text` / `assemble_tag_posts_text` resolve it via the same `list_feed` the Posts feed uses (so a summary reflects what the feed shows). An explicit `postsText` still wins → the **semantic/related** path and **generateBackgroundSummary** are preserved (dual-mode).
- The AI paths assemble **all** posts in scope (never a page). **Budget guardrail:** an oversized selection (> 10k posts or ~200k estimated tokens) is refused with a **clear 413** — never a silent truncation of the user's posts (future: partition-and-aggregate).

**Frontend**
- `getPromptPostsInput()` returns `{ scope }` (server-eligible) or `{ posts }` (semantic → client formats). Summary/chat/tag send the scope; post count comes from `/data/posts/counts`; summary citations resolve via `/data/posts/lookup` after streaming.

**Parity note:** formatting is byte-identical; the *selection* unifies on `list_feed` (keyword/forwarded/media/sort verified to match `buildFilteredPostsFromRaw` — only rare timestamp-tie ordering can differ).

## T4.3 — closed by measurement
780 channels, ~135 kB (≈250–400 kB JSON), fetched once and etag-cached — not worth the server-side rewrite + two-UI-surface churn. Documented in the plan; revisit if the list grows.

## Verification
- Backend: **500 pytest** + mypy + ty + ruff.
- Frontend: **472 unit** + tsc + biome + tg-ui.
- E2E: **51/51** Playwright against a from-branch backend (includes the tag "Copy Prompt" flow now routing through the scope path).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
