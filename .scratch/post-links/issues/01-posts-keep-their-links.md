# LINK-01: A Post keeps its Links

**What to build:** Addresses in a Post's body become clickable, masked Links included, and none of
them takes the viewer out of the app. The scraper stores every anchor in the body as a Link, a
position over `Post.text` plus the href, in a new `tg_posts.link_spans` column. One renderer draws
them on the four surfaces that show a whole Post, and falls back to a regex for Posts scraped
before this ticket and for translated text. See `.scratch/post-links/spec.md` and ADR-022.

**Blocked by:** none.

**Status:** resolved

### Backend

- [x] Alembic revision adds nullable JSON `tg_posts.link_spans`, with no backfill; grep for a duplicate revision id before trusting "Multiple head revisions"
- [x] The scraper emits `link_spans` for every anchor in `message_body_element`'s node, never the reply excerpt: `{offset, length, url}` in UTF-16 code units against the final stored text (after `.strip()`), href verbatim, ordered by offset
- [x] A Post whose stored text is a placeholder or poll question stores `[]`, never positions into text they were not measured against
- [x] `_posts_to_save` and `bulk_upsert_posts_impl` carry the key the way they carry `links`; `link_spans` does not reset `references_extracted`
- [x] An upsert that changes `text` without carrying `linkSpans` sets `link_spans` to `NULL`, so stale positions never land on new words
- [x] `post_to_camel` and the Post schema expose `linkSpans`; export and import carry it, and an import of an export that predates the column leaves Posts importable
- [x] The stale comment in `bulk_upsert_posts_impl` claiming sync re-scrapes the newest page is corrected
- [x] Parser tests over the live fixtures cover: a masked Link with nested `<b>`, a bare URL whose words differ from its href, a mention, a `tg://` Link (stored, verbatim), the lone-`.` masked Link, an emoji before a Link (UTF-16 offset differs from the code-point offset), and leading whitespace removed by `.strip()`
- [x] Projection guards (`test_*_projection.py`), the export coverage guard and the account-isolation probes are updated, not deleted; the client is regenerated (`bash scripts/generate-client.sh`)

### Frontend

- [x] `renderPostText` takes the Post's `linkSpans`; stored Links render when the field is a list, the regex fallback runs only when it is `null`/absent, and an empty list links nothing
- [x] The fallback links mentions, `http(s)://` URLs and scheme-less `t.me/` / `telegram.me/` paths, and no bare domains
- [x] Telegram hrefs: a channel or channel/post shape opens the configured web view (today's mention target); other Telegram paths keep their path on the configured domain; hosts are the configured domain, `t.me` and `telegram.me`
- [x] Only `http`, `https` and `mailto` render as anchors; `tg://`, relative and anything else render as plain words
- [x] Every rendered anchor, fallback included, has `target="_blank" rel="noopener noreferrer"`; a Link whose words differ from its URL has `title` set to the address a click opens
- [x] The search highlight still applies inside a Link's words
- [x] `PostCard` (original and translation), `CitationHover`, Chat sources and Discover's reference Post all render through it, and each surface's data carries `linkSpans`; clicking a Link does not trigger the card's own click handler
- [x] Unit tests cover: stored spans, `null` falling back, `[]` linking nothing, the scheme allowlist, both rewrite cases, `target`/`rel` on every anchor, the masked `title`, a highlight inside a Link, and an emoji before a Link
- [x] Every new guard and test is mutation-tested (watched red before trusted)

## Comments

Implementation notes (2026-09-23):

- The placeholder rule needs no check of its own. When a body exists the stored text is that body's text, and without one there are no anchors, so a `body_text == text` comparison could never go red. `test_every_live_link_lands_on_its_own_words` guards the real risk instead: the text and the positions are flattened by two functions, and that test slices every Link in every captured page back out of the stored text.
- No projection guard pinned the Post key set, so none needed changing; `test_links_travel_through_import_the_api_and_export` is the guard for the field now.
- `PostCard` passes the stored Links whenever the words on screen are the Post's own (`activeText === post.text`), so a translation that came back unchanged keeps them.

Code review (2026-09-23, Standards and Spec axes):

- Fixed: a malformed `linkSpans` entry sent through import or `/data/posts/bulk` was stored as-is and would have 500'd every read of that Post, for every Follower. `_post_link_spans_from_item` now keeps only `{offset: int, length: int, url: str}` entries.
- Fixed: `PostLinkSpan` is re-exported from the generated client instead of restated in `types.ts`; `linkHref` reuses `channelFromTelegramPath`; the text and the positions share one `_flattened` helper; `legacyDomains` is now `telegramHosts`; comments no longer join clauses with colons or count the Post's keys.
- Kept: the `title` shows the address a click opens (the web view for a Telegram Link) rather than the stored href, because that is the destination the tooltip exists to reveal. The spec line is amended to say so.
