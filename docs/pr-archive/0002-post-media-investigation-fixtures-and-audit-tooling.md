# #2 Post media investigation: fixtures and audit tooling

**State:** merged 2026-07-04 · **Branch:** `feat/post-media-investigation` into `main` · **Diff:** +24817 / -2 across 52 files · **Opened:** 2026-07-04

---

## Summary
- Document Telegram post media markup patterns and audit workflow in `docs/post-media-investigation.md`.
- Add `capture_scrape_html.py` and `audit_post_media.py` plus frozen live HTML fixtures for parser development.
- Extend pre-commit/typos config to exclude large fixture paths.

## Test plan
- [ ] Run `python backend/scripts/audit_post_media.py` against fixtures (no DB required).
- [ ] Confirm pre-commit passes on touched paths.

Made with [Cursor](https://cursor.com)
