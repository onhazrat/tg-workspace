# ADR-027: The Directory is searched with Postgres full-text search, in a companion table

**Status:** Accepted (2026-10-04). Research: `.scratch/directory-tab/research-search-index.md`.
Prototype: `proto.search_doc` on branch `prototype/directory-tab`.

## Context

The Directory tab searches Channels by words in their name, bio and recent Posts, across a
corpus of about 320K live Channels with up to 20 sample Posts each (4.2M samples, ~5 GB). The
text is mostly Russian, then English, Persian and Chinese, with Ukrainian, German, Arabic and
Japanese behind them. Samples are replaced wholesale whenever an entry is re-probed. The
deployment is one PostgreSQL 18 container on an 8 GB VM.

The prototype indexed every entry once with `to_tsvector('simple', ...)`. It answered in 0.2 to
2.7 s and showed the gaps: no stemming, so Russian and Persian word forms miss; Persian words
split oddly around the zero-width non-joiner; and Chinese and Japanese runs become one token,
because Postgres has no word splitter for them.

## Decision

Index each live Directory entry in a companion table, `tg_channel_directory_search`, owned by
the Directory aggregate as its payload table and scoped `CORPUS` like the entry. It holds one
tsvector built from the handle and display name (weight A), the bio (B) and the 8 newest
samples capped at 12,000 characters (C), behind `GIN (tsv) WITH (fastupdate = off)`, plus a
trigram index on handle and display name for names typed with typos.

The text search configuration is chosen per row from the entry's Language (ADR-021): russian,
english, german and arabic are stemmed, every other Language uses `simple`. Text is normalised
in Python before `to_tsvector`, as Discourse does: Persian letter variants are folded so the
arabic stemmer applies, the zero-width non-joiner becomes a space, and Chinese and Japanese runs
become overlapping two-character pieces.

The row is rebuilt in the same transaction as every writer that changes its inputs (a probe
result, a metadata sync, a recheck, sample retention), with an `index_version` so a change to
the recipe re-indexes old rows in the background. Snippets are cut in Python, for the rows on
the page only.

## Considered options

- **A sibling tsvector column on the entry.** Rejected by the repo's companion-table rule: a
  large field on the entry is detoasted by every list read. A generated column also cannot read
  the sample rows.
- **A trigger.** Twenty sample deletes and inserts per probe would fire it repeatedly, and a
  trigger cannot run the Python normalisation.
- **pg_trgm over all the text, pg_bigm or PGroonga.** Trigrams over 5 GB are large and cannot
  match one- or two-character Chinese words; pg_bigm and PGroonga have no PG 18 packages in
  PGDG and would need a custom image (PGroonga also keeps its index outside the WAL).
- **ParadeDB (BM25).** Better ranking and real tokenizers, but AGPL, still 0.x, and a custom
  image. The first thing to try if ranking or latency falls short.
- **Meilisearch, Typesense or Elasticsearch.** A second service and a sync pipeline; Typesense
  alone would want 4 to 6 GB of RAM for this text, which this VM does not have.
- **Embeddings instead of keywords.** A complement, not a replacement: they come later as a
  second ranked list merged by reciprocal rank fusion, which needs pgvector and supersedes
  ADR-005.

## Consequences

- The table turns over about weekly as entries are refreshed; it needs its own autovacuum
  settings.
- A query ORs each term across the configurations in use, one GIN probe per configuration per
  term. Measure it before adding a fifth configuration.
- A Russian-detected Channel posting in Ukrainian is stemmed as Russian; it still matches by
  prefix.
- `shm_size` must be raised on the database service: Docker's 64 MB default made parallel hash
  joins over the reference graph fail on staging (2026-10-03).
