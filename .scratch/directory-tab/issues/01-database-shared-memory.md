# DIR-01: Raise the database container's shared memory

**What to build:** Parallel queries stop failing on staging. The database service runs with
Docker's default 64 MB of shared memory, and on 2026-10-03 a parallel hash join over the
References overflowed it ("could not resize shared memory segment ... No space left on device").
Any parallel query running at that moment would have failed the same way, the app's included.
Raise the service's shared memory (256 MB is the working figure) and record why beside the
setting. See `.scratch/directory-tab/spec.md`: user story 99, "No parallel workers are assumed", and
ADR-027's consequences.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

This is for a human because applying it restarts staging's database. Nothing else in the Directory
tab waits on it, but the later tickets' heavy queries are safer with it in place.

- [ ] The database service's shared memory is raised in the compose file, with a comment naming the failure it prevents
- [ ] Local compose and staging both run with the new size, checked with `df` on the container's shared memory mount
- [ ] A parallel query that overflowed 64 MB (the similarity query from the prototype is the known case) completes on staging
- [ ] The staging database log shows no "could not resize shared memory segment" after the change
- [ ] `deployment.md` mentions the setting where it describes the database service
