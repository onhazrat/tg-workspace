# DIR-05: Who cites whom

**What to build:** The Account filters and sorts the Directory by how widely a Channel is cited
and how many Channels it cites, finds the Channels a given Channel cites or is cited by, and sees
in the panel who cites a Channel most and whom it cites most, one click from turning either into a
filter. See `.scratch/directory-tab/spec.md`: user stories 52, 53, 80 and 81, and the
implementation decisions on citation pairs, Reference kinds and every new table's place in the
inventories.
**ADR-028** records why citations are kept as distinct Channel pairs; read it before starting.

**Blocked by:** DIR-03

**Status:** done

Every count here is in distinct Citing Channels, never Reference rows: a plain @mention is stored
as both a mention and a link Reference.

- [x] A citation pair table holds one row per distinct citing Channel and cited Channel with its Reference count, and a count table holds, per handle, how many distinct Channels it is cited by and cites; both keyed by handle, not by Directory entry
- [x] The References writer maintains both in the transaction that inserts References, from the rows it reports as new: a new pair is upserted and raises its target's cited-by and its source's cites by one; an existing pair only gains References. Nothing decrements, because References are permanent
- [x] A first-fill script builds both from the existing References, in batches, safe to re-run
- [x] A guard asserts that after the writer runs, the stored counts equal a fresh aggregation over the References; it is watched to fail by skipping the count update
- [x] Conditions: cited by at least N Channels, cites at least N Channels, cited by @handle and cites @handle (one or more handles), each in the Filters picker's References group and in the text form (`citedby:`, `cites:`, and a bound for the two counts)
- [x] DIR-02's view-level Reference kinds setting narrows "cited by @handle" and "cites @handle"; the stored cited-by and cites counts are over every kind and are not narrowed, and the Reference kinds pill's heading says which counts it narrows
- [x] The Cited by and Cites columns and sorts read the counts; the page is joined to them only when a Condition or the sort reads them
- [x] A neighbours operation returns, for one Channel, the Channels citing it most and those it cites most, with names and the kinds involved; the panel lists both
- [x] One click from those lists adds "cites @x" or "cited by @x" to the filter
- [x] The tenancy seam classifies both tables as corpus, the service-kind guard has them as the References aggregate's payload with its writer as sole writer, the test cleanup inventory lists them, and export omits them with a reason (they are derived)
- [x] The Directory HTTP test module covers each Condition, the Reference kinds setting on the two handle Conditions and not on the stored counts, negation, the columns and sorts, and the neighbours operation for two Accounts, with data created by writing References
- [x] The first fill's run time and the tables' sizes on a staging-sized database are measured and written in the ticket's comments

## Comments

- 2026-10-06, implementer. Tables `tg_citation_pairs` (PK citing, cited; index on cited) and `tg_citation_counts` (PK handle), migration `96ca1cdc4d39` on `086f79ada387`. `write_references` now returns the inserted References' (source, target) and folds them in: new pairs through `INSERT ... ON CONFLICT DO NOTHING RETURNING` (exact under concurrency, unlike the `xmax = 0` trick), existing pairs gain References by `UPDATE`, counts by an upsert, all through `unnest` arrays so no batch hits the bind-parameter ceiling. Guard: `tests/services/test_citation_pairs.py` (fresh aggregation equals the stored tables after the writer, the walk, a probe and the fill; sole writer by grep), mutations listed there.
- First fill (`backend/scripts/backfill_citation_pairs.py`) on `app_staging_proto` (3,330,014 References): 15 s, 1,722,025 pairs (396 MB with indexes), 520,737 handles counted (93 MB). A re-run took 27 s and changed nothing; both tables matched a fresh aggregation exactly. Beside a live worker a write racing a batch can leave a count one short; a second run settles it (documented in the script and `development.md`).
- Reads on the same copy (282 follows, no parallel workers): opening view sorted by Cited by 0.27 s, by Cites 0.24 s (by Yours 0.19 s); `cited_by >= 10` 0.37 s; `cites >= 5` 0.35 s; `citedby:` one handle 0.13 s, forwards only 0.07 s; `cites:` the most-cited handle 0.14 s warm (0.57 cold); distribution 0.39 s; neighbours 0.01-0.04 s. The first version read the counts with a correlated lookup per entry and took 2.6 s for a bound; the counts are now joined (LEFT JOIN) only when a Condition, the sort or the spread reads them (`directory_reads._entries`).
- "Cited by N" and "cites N" are two new measures (`cited_by`, `cites`), so the bound editor, its spread, the sort picker, the column headers and the panel's counters all get them for free. A handle with no counts row is 0, a value, so `cited_by = none` matches nothing. Their editor is the bound editor; the picker shows them in the References group with "Cited by @channel" / "Cites @channel". Text form: `cited_by >= 5`, `cites <= 0`, `citedby:durov`, `cites:"a b"` (the unquoted form cannot carry "@"; inside quotes it is optional). At most 50 handles per Condition.
- "Cited by @x" and "cites @x" read the References live, not the pairs, because the Reference kinds narrow them and a pair keeps no kinds. Neighbours are not narrowed by the kinds; the list shows each neighbour's kinds instead. 10 per side, ties by handle.
- Clicking a neighbour's filter button adds the Condition and closes the panel, as the prototype did, so the narrowed list shows (a full-screen panel on a phone would hide it otherwise).
