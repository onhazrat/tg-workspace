# DIR-05: Who cites whom

**What to build:** The Account filters and sorts the Directory by how widely a Channel is cited
and how many Channels it cites, finds the Channels a given Channel cites or is cited by, and sees
in the panel who cites a Channel most and whom it cites most, one click from turning either into a
filter. See `.scratch/directory-tab/spec.md`: user stories 44 to 46, 67 and 68, and the
implementation decisions on citation pairs and every new table's place in the inventories.
**ADR-028** records why citations are kept as distinct Channel pairs; read it before starting.

**Blocked by:** DIR-03

**Status:** ready-for-agent

Every count here is in distinct Citing Channels, never Reference rows: a plain @mention is stored
as both a mention and a link Reference.

- [ ] A citation pair table holds one row per distinct citing Channel and cited Channel with its Reference count, and a count table holds, per handle, how many distinct Channels it is cited by and cites; both keyed by handle, not by Directory entry
- [ ] The References writer maintains both in the transaction that inserts References, from the rows it reports as new: a new pair is upserted and raises its target's cited-by and its source's cites by one; an existing pair only gains References. Nothing decrements, because References are permanent
- [ ] A first-fill script builds both from the existing References, in batches, safe to re-run
- [ ] A guard asserts that after the writer runs, the stored counts equal a fresh aggregation over the References; it is watched to fail by skipping the count update
- [ ] Conditions: cited by at least N Channels, cites at least N Channels, cited by @handle and cites @handle (one or more handles). Every Reference Condition, including DIR-02's "cited by the selected Channels", takes optional Reference kinds (forward, mention, link, reply)
- [ ] The Cited by and Cites columns and sorts read the counts; the page is joined to them only when a Condition or the sort reads them
- [ ] A neighbours operation returns, for one Channel, the Channels citing it most and those it cites most, with names and the kinds involved; the panel lists both
- [ ] One click from those lists adds "cites @x" or "cited by @x" to the filter
- [ ] The tenancy seam classifies both tables as corpus, the service-kind guard has them as the References aggregate's payload with its writer as sole writer, the test cleanup inventory lists them, and export omits them with a reason (they are derived)
- [ ] The Directory HTTP test module covers each Condition, Reference kinds, negation, the columns and sorts, and the neighbours operation for two Accounts, with data created by writing References
- [ ] The first fill's run time and the tables' sizes on a staging-sized database are measured and written in the ticket's comments
