# 03: Entries go stale and refresh

**What to build:** A Directory entry for a live Channel goes stale and comes due again on a schedule the Operator controls; a dead one never does; and a Channel somebody follows stays current for free.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Due-ness is a new column, separate from the retry-backoff field
- [ ] A dead verdict — bot, group, user account, private, deleted — never becomes due again
- [ ] A live entry becomes due after a configurable window, defaulting to one week, as deployment policy rather than per-Account
- [ ] Widening the window reduces steady-state request volume, and is the Operator's lever if Telegram pushes back
- [ ] An entry can be refreshed on demand, jumping the queue
- [ ] Due-ness and retry backoff move independently
- [ ] The metadata sync already fetches on every run also updates that Channel's Directory entry, with no additional request
- [ ] That metadata-only update does not clear existing samples

## Notes

The retry field means "this fetch failed, back off"; due-ness means "this answer is old". Same type, opposite cause, and conflating them once already produced a starvation bug the module documents.

This is where ticket 02's "payload with no samples key" rule becomes load-bearing in production.
