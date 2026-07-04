# Post media investigation (Phase A)

**Date:** 2026-07-04
**Status:** Phase A complete (A1 script ready, A2 fixtures captured, A3/A4 synthesis below). Awaiting interactive gate before Phase B.

## 1. Audit summary (Stream A1)

| Item | Status |
| ---- | ------ |
| Script | `backend/scripts/audit_post_media.py` — ready |
| `audit_report.json` | **Not produced** — local Postgres unavailable in agent environment |
| Blockers | Docker CLI missing; `localhost:5432` refused |

See `backend/tests/fixtures/live/audit_status.txt` for rerun steps:

```bash
docker compose up -d db
cd backend && alembic upgrade head
# sync sample channels via app
uv run python backend/scripts/audit_post_media.py --json
```

**Implication:** Backfill priority and `thumbCacheMaxSizeMb` scaling cannot use real channel counts yet. Fixture analysis (below) substitutes for audit until DB is populated.

---

## 2. Fixture capture summary (Stream A2)

- **22 HTML files** + sidecar `.meta.json` in `backend/tests/fixtures/live/`
- **408** `.tgme_widget_message` widgets across all fixtures
- **332** posts with detectable media HTML (81%)
- Channels: `@durov`, `@ReutersWorldChannel`, `@Premium`, `@telegram`, `@TelegramTips`, `@contest`
- Wave 2 (audit top offenders): skipped — no audit JSON
- Gap-fill: voice, document, poll, video-only — **not found** in web-view HTML

---

## 3. Gap matrix

| Type | In HTML? (fixtures) | Parsed today? | Proposed v1? | Notes |
| ---- | ------------------- | ------------- | ------------ | ----- |
| photo | Yes (85 posts) | Caption only; kind/thumb ignored | **Yes — P0** | 18 photo-only posts → `[Media/No Text Content]` |
| video | Yes (198 posts) | Caption only | **Yes — P0** | All videos in set have captions; no `video_duration` in HTML |
| link_preview | Yes (49 posts) | Caption only (URL in text) | **Yes — P1** | Structured `title`/`description` in `.link_preview_*` nodes |
| grouped | Yes (6 posts) | Caption only | **Yes — P1** | One row + `grouped_count`; often coexists with photo/video |
| views | Yes (99.8% posts) | Ignored | **Yes — P1** | `.tgme_widget_message_views` display string |
| reactions | Yes (45.1% posts) | Ignored | **Yes — P2** | Present on @durov; absent on news-style channels |
| voice | **No** | N/A | **Deferred v1.1** | Gap-fill channels returned no `.tgme_widget_message_voice` |
| document | **No** | N/A | **Deferred v1.1** | No `.tgme_widget_message_document` in captures |
| poll | **No** | Poll question text only if widget present | **Deferred v1.1** | @TelegramTips "poll" posts are video tutorials, not poll widgets |
| video-only | **No** | Would be placeholder | **P0 when found** | Parser should synthesize `[video]` even without duration |

---

## 4. Parser vs HTML — fixture analysis

Method: BeautifulSoup scan of each `.tgme_widget_message` compared to `_parse_posts_from_html` output (`backend/app/services/scraper.py`).

### Aggregate stats

| Metric | Value |
| ------ | ----- |
| Total widget posts | 408 |
| Posts with media HTML | 332 |
| `[Media/No Text Content]` among media posts | 18 (5.4%) |
| Posts with views node | 99.8% |
| Posts with reactions node | 45.1% |
| Videos with `.tgme_widget_message_video_duration` text | 0 / 198 |

### What the parser does today

```29:66:backend/app/services/scraper.py
def _parse_posts_from_html(
    html: str, start_id: int, seen: set[int]
) -> tuple[list[dict[str, Any]], str | None]:
    ...
        text_el = el.select_one(".tgme_widget_message_text")
        if text_el:
            ...
            text = text_el.get_text(strip=True)
        else:
            poll_el = el.select_one(".tgme_widget_message_poll_question")
            ...
            else:
                text = ""
    ...
            "text": text or "[Media/No Text Content]",
```

**Preserves:** caption text, poll question (if widget exists), forward metadata.
**Drops:** all media kinds, thumbs, views, reactions, link-preview structure, grouped count, duration.

### Per-type behavior

| Scenario | HTML present | Parser output | v1 fix |
| -------- | ------------ | ------------- | ------ |
| Photo+caption | photo_wrap + text | Caption ✓ | Add `kinds: ["photo"]`, cache thumb |
| Photo-only | photo_wrap, no text | `[Media/No Text Content]` | `text: "[photo]"`, `is_media_only: true` |
| Video+caption | video_player + text | Caption ✓ | Add `kinds: ["video"]`; duration optional |
| Link+caption | link_preview + text | Caption ✓ (URL inline) | Add `link_preview: {title, description, siteName}` |
| Grouped+caption | grouped_wrap + photo/video | Caption ✓ | Add `grouped_count`, both kinds |
| Text-only | text node only | Caption ✓ | No `media` field |
| Poll widget | poll_question + options | Question as text (untested) | Defer — no fixture |

### Canonical regression posts

| Post | Fixture | Issue |
| ---- | ------- | ----- |
| durov/522 | `durov_522.html` | Photo-only → placeholder; thumb URL in `background-image` |
| durov/6–16 | `durov_20.html` | 6 early photo-only placeholders |
| durov/510 | `durov_512.html` | Grouped + photo; caption OK, no album metadata |
| durov/504 | `durov_512.html` | Link preview + caption |
| ReutersWorldChannel/151505 | `ReutersWorldChannel_151505.html` | Photo+caption news pattern (views, no reactions) |
| TelegramTips/244 | `TelegramTips_246.html` | Video + grouped layers |

---

## 5. Surprises and edge cases

1. **Video duration absent on embed** — `.tgme_widget_message_video_duration` is empty for all 198 video widgets. Do not rely on duration in v1; synthesize `[video]` without timestamp unless HTML provides it.

2. **Photo-only is the main placeholder source** — All 18 placeholders are photo without caption (mostly early @durov posts). Video-only was not found in captures.

3. **Voice/document/poll not in web view** — Telegram public embed does not render these widget types in channels tested. Parser should include selectors for future-proofing but v1 UI/filters should not promise them.

4. **Grouped albums share one message row** — `grouped_wrap` coexists with photo or video; `grouped_layers` count is available (typically 1 visible layer in embed, full count may need item nodes).

5. **Views nearly universal; reactions channel-dependent** — News channels (Reuters) show views only; @durov shows emoji reaction summaries.

6. **CDN thumb URLs are scrape-time only** — Photo `background-image` and video poster URLs use `cdn*.telesco.pe` signed paths. Must download at sync/backfill; never persist CDN URL as UI src.

7. **Channel name casing matters** — `reutersworld_root.html` failed (`Channel is not available`); correct handle is `ReutersWorldChannel`.

8. **Poll question fallback already in parser** — Code path exists but no fixture exercises it.

9. **Caption formatting** — `.tgme_widget_message_text` includes inline links and emoji; `get_text(strip=True)` collapses whitespace — acceptable for v1.

10. **"This media is not supported in your browser"** — Not observed in current fixtures; monitor in parser tests.

---

## 6. Open questions for interactive gate

| # | Question | Finding | Proposed default |
| - | -------- | ------- | ---------------- |
| Q1 | Drop rare types from v1? | voice/document/poll absent in HTML | Defer to v1.1; keep parser hooks |
| Q2 | Backfill priority? | Audit not run; 5.4% placeholders in fixtures | **High** for channels like @durov; confirm after audit |
| Q3 | Views/reactions in PostMedia + UI? | Views 99.8%, reactions 45% | Include both; reactions optional in UI |
| Q4 | Voice/document thumb strategy? | No HTML | Icon-only when types appear later |
| Q5 | Grouped albums | One widget per post | One row + `grouped_count` |
| Q6 | `thumbCacheMaxSizeMb` default? | No post count from audit | **512 MB** until audit; scale to 2048 if >50k posts |
| Q7 | Filter taxonomy | Types seen: photo, video, link, grouped | 6 filters (see Phase B); defer voice/doc/poll filters |
| Q8 | Unavailable web-view channels? | `reutersworld` typo capture | Exclude bad handles from backfill defaults |

---

## Phase B Revised Scope

*Stream A4 synthesis — authoritative for Phase B execution after gate approval.*

### PostMedia contract (finalized fields)

```python
class PostMedia(BaseModel):
    kinds: list[Literal[
        "photo", "video", "voice", "document", "poll",
        "link_preview", "grouped"
    ]]
    caption: str | None = None          # raw caption if distinct from synthesized text
    duration_sec: int | None = None     # populate when HTML provides duration
    thumb_api_path: str | None = None   # /api/v1/telegram/post-thumb/{ch}/{id}
    views: str | None = None            # display string, e.g. "2.23M"
    reactions: str | None = None        # emoji summary when present
    link_preview: dict[str, str] | None = None  # title, description, site_name
    poll: dict[str, Any] | None = None        # question, options[] — v1.1 when fixtures exist
    grouped_count: int | None = None
    is_media_only: bool = False
```

**Not persisted:** `thumb_source_url` (transient at scrape time only).

**Synthesized `text` rules (parser):**

| Condition | `text` | `media` |
| --------- | ------ | ------- |
| Caption + media | Keep caption | Set kinds + metadata |
| Media, no caption | `[photo]`, `[video]`, `[photo album]` etc. | `is_media_only: true` |
| Text only | Unchanged | `media` null or omitted |
| Poll widget (future) | Question + options in text | `media.poll` structure |

### Parser priorities

| Priority | Scope | Rationale |
| -------- | ----- | --------- |
| **P0** | photo, video, `is_media_only`, synthesized placeholder text, photo/video thumb extract + cache | Fixes 5.4% placeholder pain; core channel content |
| **P1** | link_preview structure, grouped_count, views | Common in @durov and news channels |
| **P2** | reactions, duration_sec (when HTML has it) | Reactions channel-dependent; duration rare on embed |
| **Deferred** | voice, document, poll widgets | No web-view fixtures; keep selectors, ship v1.1 when captured |

Extract to `backend/app/services/post_media_parser.py`; `_parse_posts_from_html` delegates per message widget.

### UI filter list (v1)

| Filter | Include v1? |
| ------ | ----------- |
| All | Yes |
| Text-only | Yes |
| Media-only | Yes |
| Photo | Yes |
| Video | Yes |
| Link preview | Yes (rename label: "Links") |
| Grouped | Yes |
| Voice | **v1.1** |
| Document | **v1.1** |
| Poll | **v1.1** |

### Thumbnail cache defaults

| Setting | v1 default | Notes |
| ------- | ---------- | ----- |
| `thumbCacheEnabled` | `true` | |
| `thumbCacheOnSync` | `true` | |
| `thumbCacheOnBackfill` | `true` | |
| `thumbCacheMaxSizeMb` | **512** | Raise to 2048 after audit if post count >50k |
| Cache scope | photo + video thumbs only | voice/document: icon-only in UI |

Disk path: `POST_THUMB_DIR` → `data/post-thumbs/`; API `GET /api/v1/telegram/post-thumb/{channel_name}/{post_id}`.

### Backfill

- **CLI only** (`backend/scripts/backfill_post_media.py`) — not scheduled
- Default target: posts with `text = '[Media/No Text Content]'` OR `media IS NULL`
- Default channels: pending audit top offenders; seed with `@durov` known high placeholder rate
- Exclude channels flagged `isUnavailableOnWebView`
- Flags: `--dry-run`, `--limit`, `--channels`, `--concurrency`, `--sleep`

### Deferred to v1.1

- Voice, document, poll parsing + UI filters (blocked on web-view fixture availability)
- `duration_sec` enrichment when Telegram embed exposes duration
- Audit-driven backfill channel list and thumb cache size tuning
- Wave 2 fixture capture from `audit_report.json` top offenders
- Reaction breakdown (per-emoji counts) — v1 stores display string only

### Phase B stream order (unchanged)

1. B0 contract (`post_media.py` + frontend mirror)
2. B1 parser + fixture tests
3. B2 DB migration + API pipeline
4. B6 thumb cache (parallel with B1/B2)
5. B3 prompts, B4 UI, B5 backfill

---

## Verification (Phase A checklist)

- [x] Capture wave 1 (durov, Reuters-style) complete
- [ ] Capture wave 2 (audit top offenders) — blocked on audit JSON
- [x] Fixture per media type **or documented why unavailable** (voice/doc/poll/video-only documented)
- [x] Investigation doc with gap matrix + edge cases
- [x] Phase B revised scope in this doc (not plan file)
- [ ] Interactive gate — **pending user approval**
- [ ] `audit_report.json` from local DB — operator action
