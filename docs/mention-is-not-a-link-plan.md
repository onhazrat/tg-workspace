# A mention is not a link: plan

Status: implemented on `fix/mention-is-not-a-link`, 2026-10-14.

## Problem

Telegram's HTML renders every plain `@handle` as `<a href="https://t.me/handle">@handle</a>`. The
scraper stores that anchor in `Post.links`, so the reference extractor wrote each mention twice:
once as a `mention` and once as a `link` with no Post id. On staging (2026-10-14, read-only count)
that was 2,077,201 of 7,319,550 References, and 1,414,988 of 3,343,001 citation pairs had an
inflated `reference_count`. Distinct `cited_by` and `cites` were never affected.

What it inflated: `tg_citation_pairs.reference_count` (Neighbours, Shared-why ordering, anything
that ranks by References), the Directory's `link` Reference kind filter, and Discover's `link`
counts and totals.

## Decisions (from grilling)

1. A Link whose words are a Channel's handle makes a `mention` Reference and nothing else
   (`CONTEXT.md`, **Reference**).
2. One heuristic for every row, since old Posts and Directory samples store no anchor words: a
   `link` with no Post id to a handle the same Post @mentions is that mention. A masked "read here"
   or a bare `t.me/foo` beside `@foo` collapses too.
3. A link to one exact Post (`t.me/foo/123`) stays a separate Reference.
4. Both extractors share `discover.link_targets` and `discover.is_the_mention`; the parity test
   compares handles **and kinds** (`reply` folded into `link`).
5. Cleanup is Alembic revision `a7d3e9f1c2b4`: `EXCLUSIVE` locks on `tg_post_references` and
   `tg_citation_pairs` (the old worker keeps extracting during `prestart`), one statement deleting
   the shadows and decrementing their pairs. No-op downgrade.
6. ADR-019 amended: permanence is about retention, not about never correcting a row the extractor wrote wrongly.
7. Stored Discovery reports are left as they were computed.

## Verification

- Seeded tests for the rule, the parity and the migration; each mutation watched red.
- Migration time: watch staging's `prestart` on deploy.
- After the staging deploy, rerun the read-only shadow count and record the leftover (expected
  near zero: shadows the old worker wrote between the commit and its own restart).
