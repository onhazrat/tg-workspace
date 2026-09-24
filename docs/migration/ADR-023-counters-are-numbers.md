# ADR-023: Channel counters and View counts are stored as numbers

**Status:** Accepted (2026-09-24). Plan: `docs/channel-counters-as-integers-plan.md`.

## Context

Telegram renders every counter as display text: `"877"`, `"9.24K"`, `"1.2M"`. We stored that text
verbatim in five `varchar` columns on both `tg_channels` and `tg_channel_directory`
(`subscribers`, `photos`, `videos`, `files`, `links`), and inside Post media JSON as `views` and a
flattened `reactions` line. The model comment argued that the exact number was not worth a parse.

The cost showed up anyway: ranking by size needs two parsers, `parse_abbreviated_count` in the
backend and `parseSubscriberCount` in the frontend, and the Directory (63k entries on staging)
cannot sort by size in SQL at all. Post media already carries the parsed twins `viewsCount` and
`reactionCounts`, so for Posts the text is a redundant, lossier copy.

## Decision

**Every counter is stored and sent as an integer, and the UI formats it back.**

- The five Channel counter columns become nullable `integer` in both tables. `NULL` means the page
  showed no counter; it is never zero.
- The API returns integers. The frontend formats with
  `Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 3 })`, which reproduces
  Telegram's own text: exact below 1,000, three significant digits above. English digits always,
  because Telegram renders ASCII digits on every channel. LLM prompts use the same formatter.
- Post media keeps `viewsCount` and `reactionCounts` and drops `views` and `reactions`. The
  flattened reaction line was ambiguous (a paid-stars chip has no emoji), so nothing is lost.
- A counter the parser rejects is stored as `NULL` with a warning; a page of Posts is never lost
  over one counter.
- Recorded sync-log payloads are not rewritten. They record what older code returned and age out
  on `sharedLogRetentionDays`.

## Consequences

- The integer is approximate above 1,000 (`28300` stands for a range about 100 wide). It sorts
  correctly between counters of different magnitude and ties within a rounding bucket, which is the
  most the source allows.
- The round trip is lossless: formatting the parsed number yields the text Telegram showed.
- The five columns convert inside the migration. It raises on any non-null value that does not
  parse; staging had none on 2026-09-24. The ~1.1M JSON rows are stripped by a batched script
  after deploy, because one transaction rewriting TOASTed JSON would block the deploy and bloat the
  tables. Readers use only the numeric keys, so leftover strings are inert until the script runs.
- Import accepts integers only. No export in the old format exists.

## Considered options

- **A numeric twin beside each string** (`subscribers_count`). Nothing breaks, but it is two
  sources for one fact, and the string can be rebuilt from the number without loss.
- **Format with the viewer's locale.** Diverges from what Telegram's page shows and reopens the
  digit-set question the frontend parser settled.
