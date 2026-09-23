# LANG-01: Posts carry a Language on write

**What to build:** Every Post written from now on carries its Language, read on the server from
its own words. Syncing a Channel, importing a document or posting to the bulk route all produce
Posts whose feed and lookup responses carry a Language: an ISO 639 code, `zxx` when the Post has no
words (a captionless photo, a sticker), or `und` when its words cannot be placed. A Post whose
words change on Telegram is read again on the next sync; an unchanged re-scrape is left alone.
Posts stored before this change stay unread (null) until LANG-03's walk reaches them. See
`.scratch/language-detection/spec.md` and ADR-021.

This ticket includes the prefactor the rest rely on: the rule for "a Post's own words" (a Post with
media and no caption has none, because its stored text is a synthesised placeholder) moves out of
Directory statistics to one shared place, and both callers use it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A Language-reading module, declared a pure transform in the service-kinds inventory, answers a code, `zxx` or `und` for a Post's own words, using fastText `lid.176` lite through `fast-langdetect` with no runtime download
- [ ] Before detection, URLs and @mentions are removed, hashtag markers are dropped with their words kept, and non-letter symbols are dropped; fewer than 20 letters, or a top score below 0.5, is `und` (code constants, not settings)
- [ ] The library's 80-character default input limit is raised, and newlines are flattened
- [ ] The own-words rule lives in one shared place, and Directory statistics uses it with no behaviour change
- [ ] Posts gain a nullable Language column plus a partial index over unread Posts, newest first; the migration writes no Post rows
- [ ] The Post write path reads new Posts, re-reads Posts whose text or media changed, and leaves unchanged Posts untouched
- [ ] An import's document Language is ignored; the Post is read on write like any other
- [ ] Feed and lookup responses carry each Post's Language as a nullable string; projection guards are updated, the client is regenerated, and the hand-written frontend types conform
- [ ] The README attributes the `lid.176` model under CC BY-SA 3.0
- [ ] Tests through the write path, using the real model on clear-cut sentences, cover: a Persian, an English and a Russian Post get their codes; a captionless photo gets `zxx`; an emoji-only Post gets `und`; an unchanged re-scrape keeps its Language; an edited Post is read again; an imported Language is ignored
