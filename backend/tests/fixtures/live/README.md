# Live Telegram web-view fixtures

Captured HTML for post-media parser development and regression tests. **Investigation only** — not used by the sync pipeline.

Regenerate with:

```bash
uv run python backend/scripts/capture_scrape_html.py --channels durov,ReutersWorldChannel
uv run python backend/scripts/capture_scrape_html.py --posts durov/522
```

Each capture writes `{channel}_{root|beforeId|postId}.html` plus a sidecar `{same}.meta.json` (`url`, `fetched_at`, `status`, `post_ids_found`, `media_scan`).

## Coverage summary

| Media kind     | Fixture evidence | Canonical example(s)                          |
| -------------- | ---------------- | --------------------------------------------- |
| photo          | Yes (85 posts)   | `durov_522:522` (no caption), `ReutersWorldChannel_root` (caption) |
| video          | Yes (198 posts)  | `durov_512:512`, `TelegramTips_root`          |
| link_preview   | Yes (49 posts)   | `durov_512:504`, `TelegramTips_246:226`       |
| grouped        | Yes (6 posts)    | `durov_512:510`, `TelegramTips_246:244`       |
| sticker        | Yes (1 post)     | `durov_50:41`                                 |
| voice          | **No**           | Gap-fill attempted — not rendered in web view |
| document       | **No**           | Gap-fill attempted — not rendered in web view |
| poll           | **No**           | Gap-fill attempted — not rendered in web view |
| audio          | **No**           | Not seen; same web-view limitation as voice   |
| roundvideo     | **No**           | Not seen; folded into the `video` kind        |
| video-only     | **No**           | All captured videos have captions             |

**The uncoverable kinds are pinned synthetically.** Telegram's web view does not
render voice, document, poll, audio or round-video posts, so no capture can
cover them — `tests/services/test_post_media_parser.py` asserts their selector
strings against hand-written markup instead. Those tests stop a refactor from
dropping a kind; they are **not** evidence that the selectors still match live
Telegram. Revisit if the web view ever starts rendering these.

Two related notes for anyone extending the parser:

- `tgme_widget_message_text` is used for **both** the post body and the reply
  quote, quote first. Always go through `telegram_html.message_body_element`.
- A link preview renders its own `js-message_video_player` and duration; those
  belong to the *linked* post. `durov_200:181` is the canonical example.

## Fixture catalog

### Wave 1 — diverse channels

| File | URL | Posts | Media mix | Notes |
| ---- | --- | ----- | --------- | ----- |
| `durov_root.html` | `https://t.me/s/durov` | 20 | photo×2, video×8, link×3, grouped×1 | Reactions on most posts; target channel |
| `ReutersWorldChannel_root.html` | `https://t.me/s/ReutersWorldChannel` | 20 | photo×20 | All photo+caption; views, no reactions |
| `ReutersWorldChannel_151505.html` | `https://t.me/s/ReutersWorldChannel/151505` | 21 | photo×21 | Single-post page window around 151505 |
| `Premium_root.html` | `https://t.me/s/Premium` | 20 | video×18, photo×1 | Official Premium channel |
| `telegram_root.html` | `https://t.me/s/telegram` | 20 | video×16, link×4 | Official @telegram channel |
| `TelegramTips_root.html` | `https://t.me/s/TelegramTips` | 20 | video×20 | Tutorial-style video+caption posts |
| `contest_root.html` | `https://t.me/s/contest` | 20 | video×1, link×1 | Mostly text; 2 media posts |

### Wave 1 — durov pagination / singles

| File | URL | Posts | Placeholders | Highlight post IDs |
| ---- | --- | ----- | ------------ | ------------------ |
| `durov_20.html` | `?before=20` | 7 | 6/6 media | **6–16** — early photo-only, no caption |
| `durov_50.html` | `?before=50` | 20 | 8/16 media | **7,8,10,11,16,31,44,45** photo-only; **37** photo+caption |
| `durov_200.html` | `?before=200` | 20 | 0/5 media | **181,199** link_preview; **191,192** video+caption |
| `durov_400.html` | `?before=400` | 19 | 0/10 media | **373** video+grouped; **398,399** photo+caption |
| `durov_510.html` | `?before=510` | 20 | 0/15 media | Mixed photo/video/link |
| `durov_512.html` | `/durov/512` | 20 | 1/16 media | **510** grouped album; **522** photo-only |
| `durov_513.html` | `/durov/513` | 20 | 1/17 media | **523** video+caption |
| `durov_522.html` | `/durov/522` | 19 | 1/12 media | **522** photo-only; **524–526** recent video |

### Gap-fill singles

| File | URL | Purpose | Result |
| ---- | --- | ------- | ------ |
| `telegram_387.html` | `/telegram/387` | Official channel window | video×15, photo×2, link×4 |
| `telegram_389.html` | `/telegram/389` | Poll/document hunt | No poll/document widgets |
| `telegram_400.html` | `?before=400` | Older @telegram window | Same mix as above |
| `TelegramTips_174.html` | `/TelegramTips/174` | Poll/voice hunt | Video tutorials only (poll *tips*, not poll widgets) |
| `TelegramTips_246.html` | `/TelegramTips/246` | Grouped + link | **244** video+grouped; **226** link_preview |
| `TelegramTips_258.html` | `?before=258` | Grouped album | **244** video+grouped |

### Failed / empty captures

| File | Status | Notes |
| ---- | ------ | ----- |
| `reutersworld_root.html` | error | Wrong casing (`reutersworld` vs `ReutersWorldChannel`) — channel unavailable on web view |

## Canonical post IDs for parser tests

Use these when writing `test_post_media_parser.py` cases:

| Test case | Fixture | Post ID | HTML signals | Current parser `text` | Expected v1 `media.kinds` |
| --------- | ------- | ------- | ------------ | --------------------- | ------------------------- |
| Photo-only (no caption) | `durov_522.html` | 522 | photo, views, reactions | `[Media/No Text Content]` | `["photo"]`, `is_media_only: true`, `text: "[photo]"` |
| Photo+caption | `ReutersWorldChannel_root.html` | 151527 | photo, views | caption text | `["photo"]`, caption preserved |
| Video+caption | `durov_512.html` | 512 | video, views, reactions | caption text | `["video"]`, caption preserved |
| Link preview+caption | `durov_512.html` | 504 | link_preview, views | caption text | `["link_preview"]`, `link_preview: {title,…}` |
| Grouped album+caption | `durov_512.html` | 510 | photo+grouped, views | caption text | `["photo","grouped"]`, `grouped_count` |
| Video+grouped | `TelegramTips_246.html` | 244 | video+grouped, views | caption text | `["video","grouped"]` |
| Text-only | `durov_512.html` | 514 | none (text only) | caption text | no `media` or empty kinds |
| Forwarded | any durov page | varies | `.tgme_widget_message_forwarded_from_name` | caption | forward fields unchanged |

## HTML selectors (starting points)

| Signal | Selector | Notes |
| ------ | -------- | ----- |
| Photo thumb | `.tgme_widget_message_photo_wrap` → `style` `background-image` | CDN URL; cache at scrape time |
| Video | `.tgme_widget_message_video_player` | Duration span often empty on embed |
| Voice | `.tgme_widget_message_voice` | Not seen in this fixture set; synthetic test only |
| Audio | `.tgme_widget_message_audio`, `.tgme_widget_message_audio_player` | Not seen in this fixture set; synthetic test only |
| Document | `.tgme_widget_message_document` | Not seen in this fixture set; synthetic test only |
| Poll | `.tgme_widget_message_poll_question`, `.tgme_widget_message_poll_option` | Not seen in this fixture set; the question is used as the post text |
| Sticker | `.tgme_widget_message_sticker_wrap`, `.tgme_widget_message_sticker` | `durov_50:41` |
| Round video | `.tgme_widget_message_roundvideo{,_player}` | Reported as the `video` kind |
| Reply quote | `a.tgme_widget_message_reply` → `.js-message_reply_text` | `contest_root:444/450/454`; never the post's own text |
| Link preview | `.tgme_widget_message_link_preview`, `.link_preview_title` | |
| Grouped | `.tgme_widget_message_grouped_wrap`, `.tgme_widget_message_grouped_layer` | Count layers for `grouped_count` |
| Views | `.tgme_widget_message_views` | Display string e.g. `2.23M`; also parsed to `viewsCount` |
| Reactions | `span.tgme_reaction` inside `.tgme_widget_message_reactions` | Per chip: count plus `i.emoji b`, or `tg-emoji[emoji-id]` for custom emoji, or `.tgme_reaction_paid` for stars. The flattened text cannot be split reliably |

## Related files

- `audit_status.txt` — Stream A1 audit run status (DB unavailable in agent env)
- `docs/post-media-investigation.md` — full gap matrix and Phase B revised scope
