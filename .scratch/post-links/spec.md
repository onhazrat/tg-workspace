# Post Links

A Post's body renders as plain text except for `@mentions`, so every other address a Channel
wrote is dead in the feed, and a masked Link ("read more" over a URL) cannot be recovered at all.
This spec makes a Post keep its Links and render them. The decision is recorded in
[ADR-022](../../docs/migration/ADR-022-post-links.md); the term **Link** is defined in
`CONTEXT.md`. Settled in a grilling session on 2026-09-23.

## Why it happens today

1. `extract_telegram_html_text` (`backend/app/services/telegram_html.py`) calls `get_text()` on the
   body, so every `<a href>` becomes its words and the address is thrown away.
2. `extract_body_links` (`post_links_parser.py`) keeps a second copy of the hrefs in `Post.links`,
   but only Telegram-hosted ones, deduped by Channel, with no positions. It exists to feed
   References, and no UI reads it.
3. `renderPostText` (`frontend/src/lib/posts/render-post-text.tsx`) links one pattern, `@handle`.
   It has one caller, `PostCard`. Citation hovers, Chat sources and Discover's reference Post print
   the body as plain text.

## Decisions

### Storage

- **Every anchor in the Post's own body is a Link**: masked phrases, bare addresses, mentions,
  hashtags, whatever Telegram marked. The quoted excerpt of a replied-to Post is not the body
  (`message_body_element` already separates them) and carries none. Formatting (bold, spoiler,
  code, quote) is out of scope.
- **Stored as positions over the plain text**, in a new nullable JSON column
  `tg_posts.link_spans`: `[{"offset": int, "length": int, "url": str}]`, ordered by offset.
  - `offset` and `length` count **UTF-16 code units** into the stored `Post.text`, which is what
    JS slices and what Telegram's own API uses. Python computes them as
    `len(s.encode("utf-16-le")) // 2`.
  - `url` is the href **verbatim**. Rewriting is a display concern (below), so a row never bakes
    in today's domain setting.
- **`Post.links` is untouched.** It stays the Reference input for CRG-01, Discover and the
  upsert's change detection. The two columns overlap (`link_spans` is a superset); folding them is
  a later ticket, if ever.
- **New scrapes only.** Nothing rescrapes stored Posts. Old rows stay `NULL`, which means "never
  read for Links". An empty list means Telegram marked nothing.
- **The column travels** in the Post API (`linkSpans`) and in export/import, the way `links` does.

### Rendering

- **One renderer, four surfaces**: `PostCard`, citation hovers (`CitationHover.tsx`), Chat sources
  (`ChatView.tsx`) and Discover's reference Post (`DiscoverCandidatePanel.tsx`). Search previews
  (truncated, inside clickable rows) and Directory samples (their own table, a one-page snapshot)
  stay plain.
- **Stored Links when present, the regex fallback otherwise.** The fallback runs only when
  `link_spans` is `NULL` and on translated text, which has no positions. It links mentions (today's
  `MENTION_RE`), `http(s)://` URLs, and scheme-less `t.me/...` / `telegram.me/...` paths (the
  pattern in `extractTextLinks`). No bare domains: `file.txt` and `e.g.` are not links.
- **Telegram hrefs follow the mirror setting.** A channel or channel/post shape
  (`channelFromTelegramPath` answers a handle) opens the configured web view, the same target
  mention links open today, bots included. Any other Telegram path (`addtheme`, `+invite`) keeps
  its path and takes the configured domain. Hosts are the configured domain plus `t.me` and
  `telegram.me`.
- **Only `http`, `https` and `mailto` are clickable.** `tg://`, a relative href or anything else
  renders as its plain words.
- **Every Link opens in a new tab**, fallback links and `mailto:` included:
  `target="_blank" rel="noopener noreferrer"`. A viewer with Gmail as their mail handler would
  otherwise leave the app on a `mailto:`. Telegram's own attributes (`onclick`, `rel`) are never
  copied; only the href is stored.
- **A masked Link shows its destination on hover**: a Link whose words differ from its URL gets
  `title` set to the address a click opens, which for a Telegram Link is the web view it is
  rewritten to.

## Facts the implementer needs

- **Sync never re-reads a stored Post.** `_persist_page_posts` (`sync_orchestrator.py`) drops
  Posts already on the page before the upsert for the `incremental` and `backfill` passes; only
  the `initial` pass re-upserts. So `link_spans` fills in through new Posts, first syncs and
  import. The comment in `bulk_upsert_posts_impl` (`posts.py`) saying sync "re-scrapes the newest
  page on every run" is stale.
- **The stored text is stripped and sometimes replaced.** `extract_telegram_html_text` ends with
  `.strip()`, so positions must be measured against the stripped string. `parse_widget_media`
  substitutes a placeholder or a poll question when there is no caption; such a Post has no body
  anchors and stores `[]`.
- **Anchors nest formatting.** Fixtures carry `<a ...><b>All Premium Features</b></a>` and
  `<a ...><u>https://...</u></a>`, and one masked Link whose words are a lone `.`. A Link's words
  are the anchor's full text, with `<br>` counted as `\n` exactly as the body extraction counts it.
- **Fixture hrefs are all absolute**: 1,255 `https`, 58 `http`, 25 `tg://` across
  `backend/tests/fixtures/live/*.html`. Mentions point at `https://t.me/<handle>` (no `/s/`). No
  fixture carries a hashtag, a bot command or an email.
- **Directory samples use the same scraper** (`_parse_posts_from_html`) but are stored in
  `tg_channel_directory_samples`. They are out of scope; the scraper may produce `link_spans` for
  them, and `channel_directory_samples._row` simply does not store it.
- **Translations** live in `tg_post_translations` as plain text; `PostCard` picks `activeText`
  and renders both through `renderPostText`.

## Out of scope

- Rescraping stored Posts. A page-level rescrape costs about 234k Requests on the staging corpus;
  an opt-in, last-N-days script is the escape hatch if masked Links in recent old Posts are missed.
- Links in Directory samples and search previews.
- Carrying masked Links into a translation.
- Merging `links` into `link_spans`.
