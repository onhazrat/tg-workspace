# 01: The Directory

**What to build:** The Discover probe table becomes the Directory — the corpus-wide map of every Channel anyone has seen referenced, followed or not. It carries the metadata a Channel already has, and on upgrade it already knows every Channel anyone follows.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The probe table, its model and its service module are renamed to the Directory, keeping the normalized-handle key and the corpus scope
- [x] Every existing verdict survives the rename, so no handle is re-probed for an answer already held
- [x] Route function names are unchanged, so operation ids hold and the generated client needs no regeneration
- [x] A Directory entry carries the photo, video, file and link counters as raw text, and the numeric chat id as a big integer, named and typed to match the columns `Channel` already has
- [x] A conclusive probe stores all five; an inconclusive one stores none of them
- [x] The camelCase projection carries the new fields
- [x] The migration seeds entries from every followed Channel's metadata
- [x] The renamed table keeps its tenancy classification and its place in the test-pollution inventory, both under the new name
- [x] Upgrade and downgrade both apply

## Notes

`tg_channels` is deliberately untouched. It is follow-scoped, its rows are collected on unfollow, and it sits on the auto-sync scheduler's hot path — see the spec for why extending it was rejected.

Seam: the probe write path.

## What shipped

- `app/services/channel_directory.py` (was `discover_probes.py`) — the module is
  now the Directory. `DirectoryEntry` replaces `DiscoverHandleProbe`;
  `tg_channel_directory` replaces `tg_discover_probes`. Both indexes and the
  primary key constraint were renamed with it, since Postgres carries none of
  them across a `RENAME TABLE` and they would otherwise keep the old name
  forever.
- Five metadata columns — the four counters as raw text and the chat id as a
  big integer — stored on the conclusive branch of the write path, cleared by a
  recheck alongside the rest of the verdict, and carried by `probe_to_camel` and
  `HandleProbeResponse`.
- `b1c2d3e4f5a6_the_channel_directory.py` — rename, columns, and an
  `INSERT ... SELECT` seeding entries from every followed Channel. The seed SQL
  is a module constant so `test_directory_seed.py` executes the statement that
  actually deploys rather than a copy that can drift.

## Caught in review

- **A seeded row needs `checked_at`/`attempted_at`.** `probe_map`, the read-time
  join every report goes through, filters on `attempted_at IS NOT NULL`. Without
  them a seeded row is stranded: `ok` is conclusive so the queue skips it
  forever, while the join hides it, and none of the seeded metadata reaches a
  reader.
- **A `tg_channels` row is not evidence a handle can be scraped.** Following a
  restricted handle still creates the Channel. The seed now claims `ok` only
  where `last_updated` shows a real sync happened, and leaves the rest to the
  probe queue.
- **The chat id is written but never cleared.** It is decoded from a message
  widget, so an `unavailable` verdict (synthesized with no page at all) yielded
  `None` and wiped it — precisely when the handle went private or was renamed,
  the one case the field exists for. The counters still overwrite, and that
  asymmetry is deliberate.
- **`normalize_handle` is `lstrip("@").strip().lower()`**, not just the
  lowercase half. The seed now matches it.

## Notes for the next ticket

- **The route function names still say `probes` on purpose.** An operation id is
  `data-<function_name>`, so renaming one moves a symbol in the generated client
  and every caller of it. A comment above the decorator says so. They move with
  the Directory's own UI.
- **Two guards asserted the probe key set**, not one:
  `test_a_resolved_probe_is_joined_into_the_report_read` and
  `test_the_probe_listing_keeps_its_key_set`. Adding a field to the response
  schema means updating both.
- A bulk rename reaches **old migration files**, and they must not move — they
  have to keep describing what they created, or a fresh install builds the new
  name and then fails to rename it. Verified with a from-zero `upgrade head` on
  a throwaway database, which is the only run that exercises that path.
