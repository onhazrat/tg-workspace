# ADR-048: A Directory entry keeps the whole profile its page shows, users included

**Status:** Accepted (2026-11-03). Decided in a grilling session that started
from what HKD-01's pages hold beyond the Handle kind. Supersedes ADR-047's
"a user's name is not stored".

## Context

Since ADR-047 the probe classifies every handle from the `t.me/<handle>` page
it already fetched. That page also shows the handle's name, its Bio and its
photo, and the probe dropped all three for every handle with no preview: the
Bio because the parser looks only where a preview page puts it, the photo on
the belief that it would cost a fetch, and a user's name by decision. On
staging, the first day after HKD-01 stored 377 Hidden Channels, 568 bots, 104
groups and 2,008 users with none of them.

The photo costs no Request: the browser loads it from Telegram's CDN, as it
already does for every readable Channel's.

## Decision

- Every Directory entry keeps the name, Bio and photo its page shows, for
  every Handle kind, users included. A free handle shows none.
- Users stay behind the gate that already hides every non-Channel kind: only a
  reader who sees internals lists them. Search indexes Channels only, as
  before, so no reader finds a person by searching.
- A photo is Telegram's URL, kept as read. A sealed entry is never refreshed,
  so the URL can die; the avatar then falls back to an initial.
- The Bio's language is a **Bio language**, its own claim beside the entry's
  Language, with its own column, filter and counts. The Bio alone decides it.
- The entries HKD-01 sealed without a profile are Rechecked once, one Request
  each. The Bio language of Bios already stored is read without a Request.

## Consequences

The Directory holds private people's names, Bios and faces, scraped from pages
they made public on Telegram. The internals gate is the only thing between
that and every reader of the deployment. A photo shown for a sealed entry may
be years old.

## Alternatives rejected

- **Users keep only their Handle kind** (ADR-047): an every-kind view of
  nameless users answers "how many cited handles are people" and nothing else.
- **One Language from Posts or the Bio**: one filter for "is this handle in
  Persian", but a Bio and a Channel's Posts disagree often enough that a
  filter mixing them stops meaning either.
- **Caching photos ourselves, or refreshing sealed entries**: each costs
  traffic per entry, which this effort exists to avoid.
- **Language from the name and the Bio together**: more letters per read, but
  Latin brand words in names pull toward English.
