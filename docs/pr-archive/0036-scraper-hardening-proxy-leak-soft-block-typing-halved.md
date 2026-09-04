# #36 🔧 Scraper hardening: proxy leak, soft-block typing, halved resolver requests, numeric counters

**State:** merged 2026-07-27 · **Branch:** `scraper-hardening` into `main` · **Diff:** +823 / -229 across 21 files · **Opened:** 2026-07-27

---

Follow-up to #34, working through the audit findings that PR deliberately left out. Four independent commits, each reviewable on its own.

## 1. `90f345b` — the soft block is a type, not a string

`"not available on the web view"` was compared as a substring in **six** places (routes ×3, sync orchestrator, bulk-follow, the fetch retry loop) while the message was defined in a seventh. Renaming it would have silently disabled retry suppression *and* the `isUnavailableOnWebView` API contract, with nothing failing.

`TelegramWebViewUnavailable` subclasses `ConnectionError`, so callers that only know about network failures keep working, while `isinstance` now separates a soft block (never retried, reported as 400) from a transport error. The message text is unchanged — it is a UI contract — and is now defined once.

`resolve_start_time_to_id` raises it instead of a bare `ValueError`, so `/resolve-start-time` grew a typed handler; its 400 + `isUnavailableOnWebView` body is unchanged and still covered by the existing API test.

Also in the network layer: `_bad_proxies` grew for the process lifetime (expired cooldowns were filtered on read, never deleted); `_tor_request_counter` was incremented without a lock from concurrent syncs, so rotations could be missed or doubled; the dead `bypass_pool` path, `_pick_random_proxy`, the `_is_telegram_web_view_url` alias and the never-read `ParsedTelegramWebViewUrl.mode` are gone. `resolve_telegram_href` no longer turns a protocol-relative `//telegram.org/x` into `https://t.me/telegram.org/x`.

## 2. `2589786` — thumbnails leaked the real egress IP 🔒

`cache_post_thumb` built its own bare `httpx.AsyncClient` per thumbnail. Every **page** fetch went through the configured proxy or Tor lane while the **media those pages referenced** went out directly — so a deployment scraping over Tor handed `cdn*.telesco.pe` its real IP, once per post, and would be blocked outright wherever t.me itself is.

`fetch_with_retry` gained a `binary=True` mode returning `(bytes, content_type)`, so thumbnails reuse the existing lane pool, retry, backoff and telemetry rather than duplicating them. The sync path passes the same proxies, concurrency and Tor settings it used for the page.

Writes are now atomic (temp file + `os.replace`). A direct `write_bytes` let a concurrent `read_cached_thumb` observe a partial file and left a truncated one behind if the disk filled mid-write. Both writes are wrapped and logged — callers gather with `return_exceptions=True`, so a full disk previously vanished with **no log line at all**. Downloads are capped at 8 MiB; `response.content` was read unbounded.

Smaller ones in the same file: `_thumb_dir_ready` was a single bool, so the `mkdir` was skipped forever after the first call even if the directory was removed or the setting repointed (now a set keyed by resolved path); `read_cached_thumb` defaulted to `image/jpeg` when meta was missing, mislabelling cached `.png`/`.webp`.

## 3. `6a9c152` — halved the resolver's requests

Every binary-search probe in `resolve_start_time_to_id` called `scrape_channel` without a known latest id, so `scrape_channel` fetched the channel **root page** purely to compute a `latest_id` the resolver already had from `get_channel_info` — and which the `?after=`/`?before=` search path never uses, since it skips the pagination loop entirely. A 12-step search issued ~28 t.me requests instead of ~14, each through the proxy pool with retries and sleeps.

New tests pin **1** request per probe with the known id and **2** without.

`scrape_channel` also carried its own copy of the timestamp enrichment, including a `from datetime import datetime` inside the loop body. The copy omitted the `timestamp = 0` fallback, so a post with no date came out of `scrape_channel` with no `timestamp` key while `scrape_channel_page` gave it `0` — two shapes for one record. `_attr_str` existed verbatim in four modules and now lives once as `telegram_html.attr_str`. `synthesize_media_only_text` lost two unreachable branches and a dead parameter.

## 4. `aaf74bf` — numeric counters, and a poll bug found on the way

`views` was stored only as a display string (`"16.4M"`, `"9.74K"`) and `reactions` as one flattened line — `'567 ❤ 10.9K 🤡 3.43K …'`. Neither sorts, and the flattened form is genuinely **ambiguous**: the leading number belongs to an emoji-less paid-stars chip, so which count goes with which emoji cannot be recovered from it.

Display strings unchanged; added `viewsCount`, `reactionCounts` (per `span.tgme_reaction`) and `reactionsCount`. Custom/premium emoji render as `<tg-emoji emoji-id>` with **no character anywhere in the markup**, so those chips carry `customEmojiId` instead of `emoji` — otherwise they are indistinguishable from one another (durov/512 has four). `parse_abbreviated_count` rounds rather than truncates: `16.4 * 1_000_000` is `16399999.999…` in binary float, so `int()` turned `"16.4M"` into 16,399,999.

**Found while writing the tests:** the poll-question extraction was dead code. It ran only on the no-kinds path, but `.tgme_widget_message_poll_question` is exactly what makes `poll` a detected kind — so the question was *always* discarded and every poll post stored as `[poll]`. It now stands in for a missing caption, which is what summaries and embeddings should have been reading all along.

A cross-channel reply now also counts toward Discover as a **`link`** signal — it is a t.me reference like any other, and same-channel replies (the common case) drop out via the existing self-reference guard. Reusing `link` avoids widening `SignalKind`, which is mirrored in both the API and the frontend.

The media kinds Telegram's web view **will not render** (voice, document, poll, audio, round video) are pinned with clearly-labelled **synthetic** markup. The fixture README already recorded that a capture attempt failed for these, so no fixture can cover them; these tests stop a refactor from dropping a kind but are *not* evidence the selectors still match live Telegram. The README's coverage matrix and selector cheat-sheet are updated to say so.

No migration in this PR — `media` is a JSON column.

## Verification

- `pytest tests/ -q` → **613 passed, 1 skipped**
- `bash scripts/lint.sh` → mypy strict, ty, ruff, ruff format all clean
- `bunx tsc -p tsconfig.build.json --noEmit` → clean; `bun test src` → **625 pass, 0 fail**

## Deliberately not done

Removing `parse_widget_media`'s `channel_name`/`post_id` kwargs. The audit flagged them as unused, but they are genuinely used by `backfill_post_media.py` and the tests — only the *production* call path doesn't exercise them, because `finalize_post_media_paths` does that work later. Deleting them would remove a working capability, so they stay.

Still outstanding from the original audit, unchanged by this PR: **no backfill of rows already stored with a replied-to post's text, and no embedding regeneration.** Forward sync only fetches ids above the last seen one, so those rows will not self-heal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
