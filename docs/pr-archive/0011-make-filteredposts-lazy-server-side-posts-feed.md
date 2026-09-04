# #11 Make filteredPosts lazy + server-side Posts feed

**State:** merged 2026-07-22 · **Branch:** `lazy-filtered-posts` into `main` · **Diff:** +1440 / -396 across 31 files · **Opened:** 2026-07-22

---

Executes `docs/lazy-filtered-posts-refactor-plan.md` and, per follow-up direction, expands it into a **server-side Posts feed**. The browser no longer downloads a channel's whole history into an eager `filteredPosts` array on every scope/filter change — that state and its effect are removed entirely (grep-clean).

## What changed (12 commits, one per increment)

**Consumers → on-demand (`getScopedPosts`)**
- AIContext (summary/copy-prompt), ChatContext, TagContext fetch the scoped posts at action time. `completePendingSummary` resolves only cited posts via `POST /data/posts/lookup`.
- Command paths: the post picker and Trim command fetch on demand (`getScopedPosts` / `/data/posts/counts`).

**Server-side feed (backend)**
- `GET /data/posts` extended into the feed source: keyword/forwarded/media filters, per-channel cap (`latest`, or a deterministic seeded `random` — `md5(channel:post_id:seed)`, so offset paging is stable), and `time`/`channel_time` sort — all in SQL (`list_feed`, windowed `ROW_NUMBER`). Defaults preserve the old newest-first page. 422 on bad sort/mode.
- New `test_posts_feed.py` (7 tests).

**Frontend feed + counts**
- `usePostsFeed` (infinite query, 20/page, more on scroll; keeps the client RAG path for semantic/related search) + `useScopedPostCounts` (SQL `GROUP BY`, client fallback for semantic). PostFeed, App "Posts in Scope", SummaryConfig gate, ChannelCard/ChannelGrid counts all read these.
- Discover is now an **action tab**: a Generate button; nothing runs until clicked.
- A completed sync invalidates the feed/counts/Discover queries so new posts appear.

Prompt building stays client-side (parent-plan **T5.1** still deferred).

## Verification
- Backend: 489 pytest + mypy + ty + ruff — green.
- Frontend: 472 unit + tsc + biome + tg-ui — green.
- E2E: **51/51** Playwright against a from-branch `:8000` backend (media-filter mock updated to honour the server-side param; Discover specs click Generate).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
