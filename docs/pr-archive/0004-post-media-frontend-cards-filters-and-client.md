# #4 Post media frontend: cards, filters, and client

**State:** merged 2026-07-04 · **Branch:** `feat/post-media-frontend` into `feat/post-media-backend` · **Diff:** +547 / -7 across 15 files · **Opened:** 2026-07-04

---

## Summary
- Regenerate OpenAPI client types for post media fields.
- Render thumbnails and media metadata on post cards; add media-aware filters and prompt formatting.
- Extend Playwright and `post-view` unit tests for media hints and filters.

## Test plan
- [x] `bun test src/lib/posts/post-view.test.ts`
- [ ] Manual smoke: post list with mixed media types
- [ ] `frontend/tests/summarizer.spec.ts` (Playwright)

Made with [Cursor](https://cursor.com)
