# LINK-01: A Post keeps its Links

**What to build:** Addresses in a Post's body become clickable, masked Links included, and none of
them takes the viewer out of the app. The scraper stores every anchor in the body as a Link, a
position over `Post.text` plus the href, in a new `tg_posts.link_spans` column. One renderer draws
them on the four surfaces that show a whole Post, and falls back to a regex for Posts scraped
before this ticket and for translated text. See `.scratch/post-links/spec.md` and ADR-022.

**Blocked by:** none.

**Status:** ready-for-agent

### Backend

- [ ] Alembic revision adds nullable JSON `tg_posts.link_spans`, with no backfill; grep for a duplicate revision id before trusting "Multiple head revisions"
- [ ] The scraper emits `link_spans` for every anchor in `message_body_element`'s node, never the reply excerpt: `{offset, length, url}` in UTF-16 code units against the final stored text (after `.strip()`), href verbatim, ordered by offset
- [ ] A Post whose stored text is a placeholder or poll question stores `[]`, never positions into text they were not measured against
- [ ] `_posts_to_save` and `bulk_upsert_posts_impl` carry the key the way they carry `links`; `link_spans` does not reset `references_extracted`
- [ ] An upsert that changes `text` without carrying `linkSpans` sets `link_spans` to `NULL`, so stale positions never land on new words
- [ ] `post_to_camel` and the Post schema expose `linkSpans`; export and import carry it, and an import of an export that predates the column leaves Posts importable
- [ ] The stale comment in `bulk_upsert_posts_impl` claiming sync re-scrapes the newest page is corrected
- [ ] Parser tests over the live fixtures cover: a masked Link with nested `<b>`, a bare URL whose words differ from its href, a mention, a `tg://` Link (stored, verbatim), the lone-`.` masked Link, an emoji before a Link (UTF-16 offset differs from the code-point offset), and leading whitespace removed by `.strip()`
- [ ] Projection guards (`test_*_projection.py`), the export coverage guard and the account-isolation probes are updated, not deleted; the client is regenerated (`bash scripts/generate-client.sh`)

### Frontend

- [ ] `renderPostText` takes the Post's `linkSpans`; stored Links render when the field is a list, the regex fallback runs only when it is `null`/absent, and an empty list links nothing
- [ ] The fallback links mentions, `http(s)://` URLs and scheme-less `t.me/` / `telegram.me/` paths, and no bare domains
- [ ] Telegram hrefs: a channel or channel/post shape opens the configured web view (today's mention target); other Telegram paths keep their path on the configured domain; hosts are the configured domain, `t.me` and `telegram.me`
- [ ] Only `http`, `https` and `mailto` render as anchors; `tg://`, relative and anything else render as plain words
- [ ] Every rendered anchor, fallback included, has `target="_blank" rel="noopener noreferrer"`; a Link whose words differ from its URL has `title` set to the URL
- [ ] The search highlight still applies inside a Link's words
- [ ] `PostCard` (original and translation), `CitationHover`, Chat sources and Discover's reference Post all render through it, and each surface's data carries `linkSpans`; clicking a Link does not trigger the card's own click handler
- [ ] Unit tests cover: stored spans, `null` falling back, `[]` linking nothing, the scheme allowlist, both rewrite cases, `target`/`rel` on every anchor, the masked `title`, a highlight inside a Link, and an emoji before a Link
- [ ] Every new guard and test is mutation-tested (watched red before trusted)
