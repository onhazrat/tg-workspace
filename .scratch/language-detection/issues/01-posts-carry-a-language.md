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

**Status:** resolved

- [x] A Language-reading module, declared a pure transform in the service-kinds inventory, answers a code, `zxx` or `und` for a Post's own words, using fastText `lid.176` lite through `fast-langdetect` with no runtime download
- [x] Before detection, URLs and @mentions are removed, hashtag markers are dropped with their words kept, and non-letter symbols are dropped; fewer than 20 letters, or a top score below 0.5, is `und` (code constants, not settings)
- [x] The library's 80-character default input limit is removed (`max_input_length=None`), and newlines are flattened
- [x] The own-words rule lives in one shared place, and Directory statistics uses it with no behaviour change
- [x] Posts gain a nullable Language column plus a partial index over unread Posts, newest first; the migration writes no Post rows
- [x] The Post write path reads new Posts, re-reads Posts whose text or media changed, and leaves unchanged Posts untouched
- [x] An import's document Language is ignored; the Post is read on write like any other
- [x] Feed and lookup responses carry each Post's Language as a nullable string; projection guards are updated, the client is regenerated, and the hand-written frontend types conform
- [x] The README attributes the `lid.176` model under CC BY-SA 3.0
- [x] Tests through the write path, using the real model on clear-cut sentences, cover: a Persian, an English and a Russian Post get their codes; a captionless photo and an emoji-only Post get `zxx`; a one-word Post gets `und`; an unchanged re-scrape keeps its Language; an edited Post is read again; an imported Language is ignored

## Comments

Delivered on branch `lang-01-post-language`. Where it differs from the text above:

- An emoji-only Post is `zxx`, as ADR-021 says, not `und`. "No letters left after cleaning" is the
  test, counted rather than tested for emptiness, because variation selectors, keycap marks and
  joiners survive cleaning as non-letters.
- The library's input limit is off (`None`), not raised: a Telegram Post can reach 4,096 characters,
  and every truncation logged a line.
- The own-words rule also treats the parser's legacy `[Media/No Text Content]` as no words, which
  shifts Directory `script` for such samples (documented in `directory_statistics`).
- `scripts/backfill_post_media.py` rewrites a Post's words outside the write path, so it re-reads the
  Language too; without it a `zxx` row would never be read again.
- The unread index is built `CONCURRENTLY`, because the old Sync worker keeps writing Posts while
  prestart runs.
- Known ceiling, marked `ponytail:` in `language.py`: the 20-letter minimum counts characters, so a
  short Chinese or Japanese sentence is `und`.
- `fasttext-predict` has no cp314 wheel and compiles from source; the full `python:3.14` base image
  carries `g++`, a slim one would not.
