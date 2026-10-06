# DIR-04: Search the Directory

**What to build:** A search box at the top of the bar, as on the Posts tab, finds Channels by words in their name,
bio and recent Posts, in every Language the corpus holds, ranks strong matches on real Channels
first, and quotes the Post and bio that matched. See `.scratch/directory-tab/spec.md`: user stories
21 to 34, and the implementation decisions on the search index, the search query and the tab. **ADR-027**
records the design and why; read it and its research before starting.

**Blocked by:** DIR-02

**Status:** ready-for-agent

- [x] A companion table of the Directory entry, one row per live Channel entry, owned by the Directory aggregate as its payload table and scoped corpus, holds the weighted search document: handle and display name (A), bio (B), the 8 newest samples capped at 12,000 characters (C); GIN with fast update off over it, and a trigram index over handle and display name
- [x] The text search configuration is chosen per row from the entry's Language: russian, english, german and arabic are stemmed, every other Language uses simple
- [x] Text is normalised before indexing and before querying: Persian letter variants folded, the zero-width non-joiner treated as a space, Chinese and Japanese runs split into overlapping character pairs
- [x] The row is rebuilt in the same transaction as every writer that changes its inputs: a probe result, a metadata sync, a recheck and sample retention; it is deleted when the entry stops being a live Channel
- [x] An index version lets a recipe change re-index old rows in the background; a backfill fills every existing entry once, in batches, and is safe to re-run
- [x] The search box is the Posts tab's, full width above the pill row, with the Name, Bio and Posts toggles as a segment inside it; every word but the last matches whole, the last as a prefix from three characters; each word is tried under every configuration in use; a trigram match on the name catches typos; search combines with every Condition
- [x] While searching, relevance ranks by match strength times the log of subscribers
- [x] A "Show matches" switch in the pill row, after the sort picker, uses the Channels tab's on/off switch; with it on, each row on the page quotes the matching bio and the newest matching Post with the matched words highlighted; snippets are cut in Python for the page's rows only; with it off the query skips them
- [x] Clearing the search box applies at once and cancels the search in flight; a superseded request is aborted
- [x] An active search shows as a chip in the shared filter row, and clearing that chip clears the box; the filter row appears while a search is on even with no Condition
- [x] While searching, the sort picker offers Relevance and switches to it; clearing the search returns to the previous sort
- [x] The search, its fields and "Show matches" join the URL and the remembered view
- [x] The mocked Playwright journey gains: type a search, see it as a chip, clear it from the chip
- [x] The tenancy seam classifies the new table as corpus, the test cleanup inventory lists it, and export omits it with a reason (it is derived)
- [x] A rebuild-equality guard: after every writer above, the stored row equals a fresh rebuild; it is watched to fail by skipping one writer
- [x] The Directory HTTP test module covers a Russian word form, a Persian letter variant, a Chinese word inside a run, a typo in a name, field limits, the prefix rule, relevance order and snippets on and off, with data created by recording probe results
- [x] The backfill's run time and the table's size on a staging-sized database are measured and written in the ticket's comments

## Comments

### 2026-10-06, backend half (branch `dir/dir-04-backend`)

**Backfill, measured on local `app_staging_proto`** (297,345 listed entries,
4.18M samples, 4.9 GB; PG 18 in the compose container, indexes in place during
the fill, as the migration leaves them). The table was created by hand there and
dropped afterwards; `alembic_version` was not touched.

* `scripts/backfill_directory_search.py`: 297,345 entries in **533 s** (8.9 min,
  ~560 entries/s, batches of 500), 99 s of it Python CPU, 230 MB peak RSS.
* Size: **1.53 GB** in all. Heap 169 MB, TOAST 902 MB (the tsvectors), GIN on
  `tsv` 406 MB, trigram GIN on `names` 46 MB, primary key 9 MB.
* Configurations: russian 204,084, simple 79,556, english 11,452, german 1,411,
  arabic 842.
* Searches through the read model under the opening view, warm, page of 100
  with snippets on: "новости" 0.48 s (22,830 found; 0.38 s snippets off, 0.84 s
  cold), "крипто" 0.16 s, "новости украины" 0.13 s, "news" 0.16 s, "the news"
  0.14 s, "crypto" name-only 0.03 s, "خبر" 0.13 s, "اخبار ایران" 0.10 s,
  "新闻" 0.09 s (2,885 found), "новости" sorted by Yours 0.33 s.

**Left for the frontend half** (unticked above): the search box and its field
segment, the "Show matches" switch, the chip, the Relevance sort item, the URL
and remembered view, request cancellation and the Playwright journey. Their
server side is done: `search {text, fields}` on every view request,
`sort: "relevance"`, `showMatches`, and `row.match` (wire shape in the DIR-04
backend notes).

**Decisions made here:**

* "Live Channel entry" is read as the list's own universe, `kind = 'channel'`
  (`channel_directory.LISTED_KIND`), so search finds exactly what the list can
  show, an unavailable Channel included (it keeps its name and bio).
* A query word that one stemming configuration drops as a stop word is left out
  of the query; otherwise "the news" misses every English Channel, whose
  documents hold no lexeme for "the".
* `sort: "relevance"` with no search is accepted and orders by handle, so a
  stale URL does not 422.
* `showMatches` defaults to false on the wire; the switch's default is the UI's.
* The backfill is a re-runnable script, not a worker job: raising
  `SEARCH_INDEX_VERSION` and re-running it re-indexes only older rows. Until it
  has run on a deployment, search finds only Channels probed since the deploy.
* Trigram typo tolerance is pg_trgm's default word-similarity threshold (0.6):
  a dropped or doubled letter in a longer name is found, a transposition in a
  short handle ("durvo" for durov) is not.

### 2026-10-06, frontend half (branch `dir/dir-04-frontend`)

Nothing left open. Decisions made here:

* The box waits 300 ms after typing stops before the view (and the URL)
  takes the text; a blank box applies in the same event. The list read hands
  TanStack Query's `signal` to the client, so the read a change supersedes is
  aborted, not left to finish. The journey watches the abort happen.
* "Show matches" is on by default (the user story turns quotes *off*); the
  URL carries `dirMatches=off` only. It is sent as `showMatches` only while
  searching, so toggling it with no search costs no read.
* URL parameters: `dirQ` (as typed), `dirIn` (only when not all three
  fields), `dirMatches`. `dirSort=relevance` without a search reads as the
  default sort.
* The sort to return to after Relevance is held in memory, not the URL: a
  reload while searching, then clearing, lands on the default sort
  ("Cited by your channels") rather than the one before the search.
* The field segment refuses to turn off its last field, as the server
  refuses an empty list.
* Clear all clears the search and every Condition in one navigation.
