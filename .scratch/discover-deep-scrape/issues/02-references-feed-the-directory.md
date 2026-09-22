# DDS-02: References feed the Directory

**Status:** resolved

## What to build

Replace the harvest sweep's Post walk with an enqueue of every `tg_post_references` target that
has no Directory entry and that nobody follows, as specified in `../spec.md`. Add the
`DIRECTORY_FOLLOW_SAMPLE_REFERENCES` switch (default on), make the Post upsert's edit reset also
clear `references_extracted`, delete the Post walk and `DIRECTORY_HARVEST_SCAN_LIMIT`, and write
ADR-020.

## Acceptance criteria

- [x] Before deleting the Post walk: explain the 325 staging Directory entries that no Reference
      names (spec, Further Notes). If the two extractors diverge, stop and bring it back.
- [x] A handle an unfollowed Channel's sample names is queued by the next tick.
- [x] With the switch off, the queued set equals what the followed-Post-only path queues.
- [x] Followed handles, known handles and self-references are never queued.
- [x] The backlog ceiling holds, and a handle skipped at the ceiling is queued later.
- [x] An edit that adds a link reaches the Directory.
- [x] The enqueue query's cost is measured on staging (19 ms / 79k References), with a `ponytail:` note; newest Reference first.
- [x] Existing harvest tests whose outcome still holds pass against the new source; walk-only
      tests are deleted.
- [x] New guards mutation-tested.
- [x] `.env.example`, the env catalog and `docs/migration/ADR-020-*.md` updated; ADR-019's
      harvest statement marked superseded.
- [x] Lint and the backend suite pass.

## Blocked by

- DDS-01 (resolved)

## Comments

**2026-09-23, parity check (staging, read-only).** Of the 325 Directory entries no Reference
names, none belongs to a Channel still in `tg_channels`, and a regex scan of all 4.68M stored
Posts for 40 of them found only false positives (x.com and GitHub URLs, plain words). Their source
Posts are no longer in the corpus, so the two extractors do not diverge. The Post walk was safe to
delete.

**2026-09-23, review.** `/code-review` flagged the alphabetical enqueue order as a regression of the
Post walk's newest-first property; restored (`ORDER BY max(timestamp) DESC`) with its test, and
the dead `harvested` reset removed from the upsert. The partial index on `harvested` still grows
with every new Post until DDS-03 drops it.
