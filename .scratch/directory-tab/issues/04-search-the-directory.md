# DIR-04: Search the Directory

**What to build:** A search box at the top of the bar, as on the Posts tab, finds Channels by words in their name,
bio and recent Posts, in every Language the corpus holds, ranks strong matches on real Channels
first, and quotes the Post and bio that matched. See `.scratch/directory-tab/spec.md`: user stories
21 to 34, and the implementation decisions on the search index, the search query and the tab. **ADR-027**
records the design and why; read it and its research before starting.

**Blocked by:** DIR-02

**Status:** ready-for-agent

- [ ] A companion table of the Directory entry, one row per live Channel entry, owned by the Directory aggregate as its payload table and scoped corpus, holds the weighted search document: handle and display name (A), bio (B), the 8 newest samples capped at 12,000 characters (C); GIN with fast update off over it, and a trigram index over handle and display name
- [ ] The text search configuration is chosen per row from the entry's Language: russian, english, german and arabic are stemmed, every other Language uses simple
- [ ] Text is normalised before indexing and before querying: Persian letter variants folded, the zero-width non-joiner treated as a space, Chinese and Japanese runs split into overlapping character pairs
- [ ] The row is rebuilt in the same transaction as every writer that changes its inputs: a probe result, a metadata sync, a recheck and sample retention; it is deleted when the entry stops being a live Channel
- [ ] An index version lets a recipe change re-index old rows in the background; a backfill fills every existing entry once, in batches, and is safe to re-run
- [ ] The search box is the Posts tab's, full width above the pill row, with the Name, Bio and Posts toggles as a segment inside it; every word but the last matches whole, the last as a prefix from three characters; each word is tried under every configuration in use; a trigram match on the name catches typos; search combines with every Condition
- [ ] While searching, relevance ranks by match strength times the log of subscribers
- [ ] A "Show matches" switch in the pill row, after the sort picker, uses the Channels tab's on/off switch; with it on, each row on the page quotes the matching bio and the newest matching Post with the matched words highlighted; snippets are cut in Python for the page's rows only; with it off the query skips them
- [ ] Clearing the search box applies at once and cancels the search in flight; a superseded request is aborted
- [ ] An active search shows as a chip in the shared filter row, and clearing that chip clears the box; the filter row appears while a search is on even with no Condition
- [ ] While searching, the sort picker offers Relevance and switches to it; clearing the search returns to the previous sort
- [ ] The search, its fields and "Show matches" join the URL and the remembered view
- [ ] The mocked Playwright journey gains: type a search, see it as a chip, clear it from the chip
- [ ] The tenancy seam classifies the new table as corpus, the test cleanup inventory lists it, and export omits it with a reason (it is derived)
- [ ] A rebuild-equality guard: after every writer above, the stored row equals a fresh rebuild; it is watched to fail by skipping one writer
- [ ] The Directory HTTP test module covers a Russian word form, a Persian letter variant, a Chinese word inside a run, a typo in a name, field limits, the prefix rule, relevance order and snippets on and off, with data created by recording probe results
- [ ] The backfill's run time and the table's size on a staging-sized database are measured and written in the ticket's comments
