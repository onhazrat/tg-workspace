# REACH-08: Readers stop falling back to media counters

**What to build:** Once every stored Post's counters live in their columns, the REACH-01 fallback to
the media keys is removed, so the columns are the only source of a View count and its reaction
chips. See `.scratch/post-view-observations/spec.md` ("Counters on Posts") and ADR-024.

**Blocked by:** REACH-01, and the REACH-01 backfill script having run on staging. Confirm that
precondition before starting: a read-only count on staging of Posts whose media still carries a
View count or reaction chips must be zero. Staging is read-only for this check; do not run the
script there yourself.

**Status:** ready-for-agent

### Backend

- [ ] The Post read path reads the three columns only; no code reads a View count or reaction chips from a Post's media
- [ ] A Post whose columns are `NULL` answers `null`, never a value from media
- [ ] The fallback's tests are replaced by one asserting that a leftover media key is ignored
- [ ] A guard fails any module outside the parser and the Post write path that reads the counter keys from Post media, and it is mutation-tested (watched red before trusted)
