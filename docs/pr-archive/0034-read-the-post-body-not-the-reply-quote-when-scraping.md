# #34 🐛 Read the post body, not the reply quote, when scraping

**State:** merged 2026-07-27 · **Branch:** `worktree-scraper-reply-fix` into `main` · **Diff:** +874 / -55 across 24 files · **Opened:** 2026-07-27

---

## The bug

Telegram's web view reuses `tgme_widget_message_text` for **both** the reply preview and the message body, and the quote comes **first** in DOM order:

```html
<a class="tgme_widget_message_reply" href="https://t.me/<ch>/<parent>">
  <div class="tgme_widget_message_text js-message_reply_text">TRUNCATED PARENT TEXT</div>
</a>
<div class="tgme_widget_message_text js-message_text">ACTUAL POST TEXT</div>
```

Two unscoped `select_one(".tgme_widget_message_text")` calls therefore returned the **replied-to** post's excerpt:

- `post_media_parser._extract_caption` → stored it as `Post.text`
- `post_links_parser.extract_body_links` → mined links from the quote, not the body

Measured on the reported page (`t.me/s/abdimedianet`): **11 of 16 posts stored the wrong text.** After the fix all 16 match their real body. On the committed `contest_root.html` fixture, the three reply posts returned **0** body links where the bodies carry **19** and **27**.

Nothing in the repo distinguished the two classes (`grep js-message_text` → zero hits) and no test covered replies, which is why it survived.

## The fix

`telegram_html.message_body_element` is now the only supported way to reach the body. It skips nodes carrying `js-message_reply_text` **and** nodes inside `a.tgme_widget_message_reply` — two independent guards, so the fix holds if Telegram renames its `js-` hooks.

## New: the replied-to post is stored

| column | type | purpose |
|---|---|---|
| `reply_to_post_id` | `INTEGER` (indexed) | queryable — reconstruct threads, join to the parent row |
| `reply_to` | `JSON` | `{channel, authorName, text, url}` for display (`text` is Telegram's truncated excerpt) |

Extraction lives in a new `post_reply_parser.py`, standalone for the same reason `post_links_parser.py` is: it must run for text-only posts, where `parse_widget_media` short-circuits. Private (`/c/…`) and invite (`/joinchat/…`) parents deliberately omit `channel` rather than storing a reserved path. Surfaced in `PostCard` as a `#<parentId>` badge beside the forwarded badge.

## Other defects fixed in the same pass

All reproduced against the 408-post fixture corpus.

| | Site | Defect |
|---|---|---|
| 1 | `post_media_parser.py` | A link preview's `js-message_video_player` was read as the post's own video. `durov/181` — a text post — reported `kinds=['video','link_preview']` and `durationSec=23`, both belonging to the *linked* post. Real videos always carry both classes (198/198); only the link-preview case has the `js-` class alone |
| 2 | `post_media_parser.py` | `.grouped_media_wrap` is the generic album *item* wrapper, not a photo marker → video-only albums tagged `photo` (`durov/373`, `TelegramTips/244`) |
| 3 | `scraper.py` | `UnboundLocalError`: `meta` was bound only inside `if not latest_id:` but read unconditionally → opaque 500 from `POST /telegram/scrape` with `knownLatestId`. The sync path uses `scrape_channel_page` and was unaffected |
| 4 | `scripts/backfill_post_media.py` | Passed a `str` where a `BeautifulSoup` was required → `AttributeError` on the first post; the script was dead on arrival |
| 5 | `scraper.py` / `telegram_web.py` | Forwarded handles were never validated, so a forward from a private channel stored `forwardedFrom="c"` (or `joinchat`, `+AbCd`) and seeded phantom auto-follow candidates. The href regex was also unanchored to the host, so `evil.example.com/t.me/foo` matched |
| 6 | `post_media_parser.py` | Views/reactions were dropped for **75 of 76** kind-less posts (early return ran before they were read); stickers were invisible entirely |
| 7 | `post_media_parser.py` | Link-preview images were never cached as thumbnails — thumb-less media posts drop from 49 to 14 (the remaining 14 genuinely have no image) |

### On the `text_only` filter

Emitting `kinds: []` for stats-only posts is safe: `_has_media()` is `coalesce(jsonb_array_length(kinds),0) > 0` and the frontend mirror is `(post.media?.kinds ?? []).length > 0`, so such posts stay `text_only` — already pinned by an existing test. New `sticker`/`audio` kinds required updating `_MEDIA_ONLY_TEXT_RE` and its declared frontend lockstep partner together; both directions are now tested.

### Note for reviewers

`except ValueError, json.JSONDecodeError:` in `scraper.py` looks like Python 2 syntax but is valid PEP 758 on this project's Python 3.14. It is not a bug — please don't "fix" it.

## Tests

Designed so this cannot come back silently.

- **`test_post_reply_parser.py`** (new) — id/channel/author/quote extraction, cross-channel, private and invite parents, non-Telegram href, malformed href; live assertion that `contest_root.html` yields exactly `{444→443, 450→449, 454→453}`
- **`test_scraper_reply_plumbing.py`** (new) — guards the seams, which drop unknown fields *silently* rather than raising: the scraper emits the fields, **`_posts_to_save` forwards them** (it is an allowlist — the single easiest thing to forget), and `scrape_channel(known_latest_id=…)` no longer raises
- **Corpus-wide invariants** parametrized over every captured page: no post's text equals its reply quote; no `photo` kind on an album with zero photo items; no `durationSec` without a `video` kind; no kind-less post drops its views
- **`test_post_links_parser.py`** — quote and body each carrying a different `t.me` link, asserting only the body's is returned; live regression on contest/450 and /454
- **Lockstep pair** — `test_post_filters.py` + `post-view.test.ts` both assert stats-only media stays `text_only` and stickers do not
- New shared `tests/utils/tg_html.py` de-duplicates the widget helpers three test files had copied

## Verification

- `pytest tests/ -q` → **576 passed, 1 skipped**
- `bash scripts/lint.sh` → mypy strict, ty, ruff, ruff format all clean
- `bunx tsc -p tsconfig.build.json --noEmit` → clean; `bun test src` → **613 pass, 0 fail**
- Alembic `upgrade head` → `downgrade -1` → `upgrade head` roundtrip clean; `--autogenerate` drift check produced no diff for the new columns or the `ix_tg_posts_reply_to_post_id` index
- Re-parsed the originally reported page: 16/16 posts now match their real body, reply metadata captured on exactly the 11 replies

## Out of scope

**No backfill and no embedding regeneration** (per decision). Posts already stored with a parent's truncated text keep it until re-scraped, and their embeddings stay computed over the wrong text — forward sync only fetches ids above the last seen one, so these rows will not self-heal. Existing `forwardedFrom="c"`/`"joinchat"` rows likewise remain and will keep appearing in the forwarded filter.

## Follow-ups (not here)

`_attr_str` duplicated across three modules; soft-block detection coupled to a substring literal in three places; `resolve_start_time_to_id` doubling its HTTP requests via a needless root-page fetch; thumbnail downloads bypassing the proxy/Tor pool; `reply_to.channel` as a new discovery signal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
