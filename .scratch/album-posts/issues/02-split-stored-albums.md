# ALB-02: Split the Albums already stored as one Post

**What to build:** Albums the sync stored before ALB-01, one Post with a photo
count above one, are split into their Posts. A one-off job, within retention,
re-walks the pages that hold them through the sync's own page fetch and writes
each missing Post with its own thumbnail, filling Album membership on the whole
Album. An Album whose page fails, or no longer shows the Album, stays one Post:
no Post is ever made without its thumbnail. The job is resumable and
idempotent, and it reports how many Albums it split and how many it left.
Replies to those Albums' photos then find their parents. The spec is
`.scratch/album-posts/spec.md`; staging held 18,084 such Albums on 2026-11-02.

**Blocked by:** ALB-01.

**Status:** done

- [x] Given a stored one-Post Album and its fixture page, the job writes the
      missing Posts and sets Album membership on all of them, with the shared
      values left on the first Post.
- [x] An Album whose page fails to fetch, or whose page no longer shows the
      Album, stays one Post and is counted as left.
- [x] Running the job a second time writes nothing.
- [x] An interrupted run resumes without redoing finished Albums.
- [x] Only Albums within retention are walked, through the same Requests and
      limits as a sync.
- [x] The job reports split and left counts; it is runnable with `--dry-run`
      first, like the other maintenance scripts, and is listed in
      `development.md`.
- [x] Tests run at the sync seam with fixture pages, mutation-checked.

## Comments

- 2026-11-02: implemented on `claude/alb-02-split-stored-albums-737b74` as
  `sync_orchestrator.split_stored_albums`, run by
  `backend/scripts/split_stored_albums.py` (`--dry-run` counts, fetches
  nothing). Choices: each Channel's walk is charged to a follower's auto-sync
  Budget (the Operator's when they follow it) and held to the sync's ceiling,
  Channel claim and page cap per run; one page splits every stored Album it
  reaches; an Album is split only when the page shows all of its stored size,
  each with a thumbnail. Channels nobody follows are skipped (Out of Scope).
  An Album left once is fetched again on the next run, which writes nothing
  unless the page now shows it whole. Not run against staging; the Operator
  runs it after deploy.
