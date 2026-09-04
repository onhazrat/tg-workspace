# #3 Post media backend: parse, persist, and thumbnails

**State:** merged 2026-07-04 · **Branch:** `feat/post-media-backend` into `feat/post-media-investigation` · **Diff:** +1182 / -16 across 20 files · **Opened:** 2026-07-04

---

## Summary
- Add `post_media` JSON on posts with Alembic migration and Pydantic schemas.
- Parse media from scrape HTML during sync; cache thumbnails on disk with retention settings.
- Expose media via API/serialization; include backfill script and parser/thumbnail tests.

## Test plan
- [x] `uv run pytest tests/services/test_post_media_parser.py tests/services/test_post_thumbnails.py`
- [ ] Run migration and backfill on a dev DB
- [ ] Full pre-commit (mypy/ruff/ty) on backend paths

## Notes
- OpenAPI/client regen lands in the stacked frontend PR.

Made with [Cursor](https://cursor.com)
