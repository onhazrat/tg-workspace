# LANG-03: The walk reads stored Posts

**What to build:** Posts stored before LANG-01 gain a Language without anyone running a script on a
deployment. A scheduled job on the Sync worker reads unread Posts newest first, a bounded batch per
tick, and relabels the Channels whose Posts it read, so the Channels tab fills in as the backfill
proceeds. Once it catches up it keeps running at next to no cost. See
`.scratch/language-detection/spec.md` and ADR-021.

**Blocked by:** LANG-02.

**Status:** ready-for-agent

- [ ] A scheduled job on the Sync worker (never the API process) reads a bounded batch of unread Posts per tick, newest first, through the unread partial index
- [ ] It writes their Languages in batched updates, then re-derives the touched Channels through the LANG-02 derivation
- [ ] The batch size is an integer setting documented in `.env.example`, with a default sized like the harvest and reference-extraction batches, and the defaults guard covers it
- [ ] A caught-up tick finds nothing and writes nothing
- [ ] No manual `VACUUM` step is required; the batch size keeps dead-tuple creation at a pace autovacuum reclaims
- [ ] Tests cover: newest Posts read first; the batch bound respected; touched Channels relabelled; a caught-up tick is a no-op
