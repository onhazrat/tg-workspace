# Directory profiles: every entry keeps the name, Bio and photo its page shows

Status: done

Ticket prefix: `PRF`.

Settled in a grilling session on 2026-11-03 that started from what HKD-01's
pages hold beyond the Handle kind. The decision record is ADR-048, which
supersedes ADR-047's "a user's name is not stored"; the terms are **Bio** and
**Bio language** in `GLOSSARY.md`, beside **Directory entry**, **Handle kind**,
**Hidden Channel**, **Language** and **Recheck**.

## Problem Statement

An Operator browsing the Directory sees a readable Channel with its name, Bio
and photo, and every other kind of handle as a bare row. Since HKD-01 the probe
reads the page Telegram serves for a handle with no preview, and that page
shows the handle's name, its Bio and its photo. The probe keeps the name for a
Hidden Channel, a group and a bot, and throws the rest away:

- The Bio is lost for every handle with no preview, a Hidden Channel included,
  because the parser looks for it only where a preview page puts it. A Hidden
  Channel's panel shows no Bio even when Telegram shows one.
- The photo is dropped on purpose, on the belief that showing it costs a
  fetch. It does not: the browser loads it from Telegram's CDN, as it already
  does for every readable Channel.
- A user's name, Bio and photo are all dropped, by ADR-047's decision.

On staging, the first day after HKD-01 stored 377 Hidden Channels, 568 bots,
104 groups and 2,008 users this way, and every one is sealed: nothing will
fetch it again, so it stays blank.

An Operator also cannot ask which handles present themselves in a given
language. A Channel's Language comes from its Posts, and a Hidden Channel, a
group, a bot and a user have no Posts the Directory can read, so they have no
Language at all.

## Solution

Every probe keeps the name, Bio and photo the page shows, for every Handle
kind, users included. A free handle shows none of them. The photo is
Telegram's own URL, as a readable Channel's already is; if it stops working,
the avatar falls back to an initial.

Every entry with a Bio gets a Bio language: the Language of its Bio, read from
the Bio alone. It is a separate claim from the entry's Language, which only
Posts decide, so a readable Channel can have both. The Directory shows Bio
language the way it shows Language: a column, a measure in the panel, a
dropdown with per-language counts in the bar, and a filter Condition typed as
`biolang:`.

Users stay behind the gate that already hides every non-Channel kind: only a
reader who sees internals lists them, and search in the default view never
matches one.

Two one-off steps catch up the existing data: the Bio language of every Bio
already stored is read without a Request, and every entry HKD-01 sealed without
its profile is Rechecked once.

## User Stories

1. As an Operator, I want a Hidden Channel's Bio stored, so that its panel says what the Channel is about even though its Posts are withheld.
2. As an Operator, I want a Hidden Channel's photo stored, so that its row and panel look like any other Channel's.
3. As an Operator, I want a readable Channel's Bio and photo to keep working as they do today, so that this change costs the listed Channels nothing.
4. As an Operator who sees internals, I want a group's name, Bio and photo stored, so that I can tell what a cited group is without opening Telegram.
5. As an Operator who sees internals, I want a bot's name, Bio and photo stored, so that I can tell what a cited bot does.
6. As an Operator who sees internals, I want a user's name, Bio and photo stored, so that I can tell who a cited person is.
7. As an Operator who sees internals, I want a free handle to show no name, Bio or photo, so that the Directory never invents a holder for a handle nobody holds.
8. As an Operator, I want a group whose page shows no Bio to have no Bio, so that Telegram's "You can view and join" boilerplate is never stored as one.
9. As an Operator, I want a free handle's "If you have Telegram, you can contact" boilerplate never stored as a Bio, so that a free handle stays empty.
10. As an Operator, I want a photo that no longer loads to fall back to the handle's initial, so that a sealed entry's dead photo never shows as a broken image.
11. As an Operator, I want storing photos to add no Request, so that the Requests tab and the Telegram Budget are unchanged by this effort.
12. As an Operator, I want every entry with a Bio to have a Bio language, so that I can ask which handles present themselves in Persian.
13. As an Operator, I want a readable Channel to have a Bio language beside its Language, so that I can see a Channel that posts in English under a Persian Bio.
14. As an Operator, I want an entry whose Bio is empty to have the Bio language No words, so that I can tell "nothing to read" apart from "not read yet".
15. As an Operator, I want a Bio too short or too mixed to place to have the Bio language Undetermined, so that a guess from twelve letters is never shown as a fact.
16. As an Operator, I want an entry whose Bio was never read to have no Bio language, so that a pending entry is not counted as No words.
17. As an Operator, I want a free handle to have no Bio language, so that a handle nobody holds is not counted among No words.
18. As an Operator, I want the Bio language read by the same rule as a Post's Language, so that the two claims use the same codes and the same thresholds.
19. As an Operator, I want an entry's Bio language to change when its Bio changes, so that a Refresh or a followed Channel's sync never leaves a Bio language describing an old Bio.
20. As an Operator, I want a Recheck to clear the Bio language with the Bio, so that a rechecked entry reads as not read yet until its answer arrives.
21. As an Operator, I want a Bio language column in the Directory table, so that I can sort and scan by it.
22. As an Operator, I want the Bio language column off by default, so that the default table is unchanged and the column does not sit beside Language unasked.
23. As an Operator, I want the Bio language column's header tooltip to say it is read from the Bio, so that I do not read it as the Language.
24. As an Operator, I want the panel to show the Bio language beside the Language, so that I can compare the two claims for one entry.
25. As an Operator, I want a Bio language dropdown in the filter bar after the Language one, with a count per language, so that I can see how the view splits by Bio language.
26. As an Operator, I want to type `biolang:fa` in the filter, so that I can list every entry whose Bio is in Persian.
27. As an Operator, I want `biolang:` to accept No words and Undetermined as Language does, so that I can find entries with an empty or unplaceable Bio.
28. As an Operator, I want the Bio language dropdown's counts to leave out its own Conditions, as the Language dropdown's do, so that picking one language does not hide the others' counts.
29. As an Operator, I want Bio language visible to every reader, so that it is not mistaken for an internal measure.
30. As an Operator who does not see internals, I want the Bio language counts to cover only what I may list, so that users never show up in my counts.
31. As an Operator, I want search never to match a user's Bio or name, so that the Directory is not a people index.
32. As an Operator, I want search to keep indexing Channels only, so that this effort adds no search documents for the ~1M handles of other kinds.
33. As an Operator, I want the Bio language of every Bio already stored filled in without a Request, so that the filter covers every readable Channel from the day this ships.
34. As an Operator, I want the entries HKD-01 sealed without a profile Rechecked once, so that they get their name, Bio, photo and Bio language.
35. As an Operator, I want that Recheck to select only entries whose Bio was never read, so that running it twice fetches nothing twice.
36. As an Operator, I want a dry run of both catch-up steps to print what each would touch, so that I can see the Request cost before spending it.
37. As an Operator, I want the old `unknown` entries left out of the Recheck, so that this effort does not spend the ~737k Requests ADR-047 deferred.
38. As an Operator, I want a merged Directory to carry Bios, Bio languages and users' names between staging and production, so that both deployments describe a handle the same way.
39. As a developer, I want one stored real page per Handle kind to pin the name, Bio, photo and Bio language the probe reads, so that a Telegram restyle fails a test instead of silently blanking profiles.

## Implementation Decisions

- **The page parser reads the profile from either page shape.** The Bio comes
  from the preview page's channel description when there is one, and
  otherwise from the description a `t.me/<handle>` page shows under the name.
  `og:description` is never used, because on a group's page it is Telegram's
  "You can view and join" boilerplate. A free handle's page carries the
  "If you have Telegram" boilerplate in the same element, so a free handle
  keeps no Bio, no name and no photo.
- **The no-preview path stops discarding.** The function that turns a
  no-preview page into a probe payload no longer nulls the photo, and no
  longer nulls a user's name. It still nulls everything for a free handle.
  Its docstring's claim that a photo "would cost a fetch of its own" goes.
- **Bio language is a new nullable column on the Directory entry**, holding a
  Language code, `zxx` (No words), `und` (Undetermined), or nothing (not read
  yet). It is read with the existing Language reader, which already returns
  No words for empty input and Undetermined below its letter floor or score
  threshold; no threshold is changed. An Alembic revision adds the column.
- **One rule writes it: wherever the Bio is written, the Bio language is
  written beside it.** The page-metadata writer that a probe and a followed
  Channel's sync share sets both, so a Bio that changes takes its Bio language
  with it. A free handle and an `unknown` page set neither. The Recheck path
  clears the Bio language with the Bio.
- **The Directory read API carries it.** The entry gains a `bioLanguage`
  field on the list and the panel reads. The column catalogue gains
  `bio_language`, public (not among the internal columns), off by default,
  sorted as words. The filter gains a Bio language Condition, written
  `biolang:<code>` in text, accepting the same values and aliases as
  `lang:`. The list response gains per-Bio-language counts computed as the
  per-Language counts are: the view without its own Bio language Conditions,
  cached the same way, and gated by the same every-kind rule.
- **The browser shows it as it shows Language.** A table column labelled
  "Bio lang", with the tooltip "The Language the Directory read from its
  Bio"; a panel measure placed after Language; a dropdown after Language's in
  the bar, labelled "Bio language". It is not added to the card measures.
- **Visibility is unchanged.** Users, with their name, Bio, photo and Bio
  language, appear only where every kind already does: the every-kind view of a
  reader who sees internals. Search is unchanged: only a Channel has a search
  document, so no reader finds a group, a bot or a user by its name or Bio
  (found while implementing PRF-01; the first draft assumed otherwise).
- **One one-off maintenance script does both catch-up steps**, with
  `--dry-run` printing both counts and touching nothing:
  - It reads the Bio language of every entry that has a stored Bio and none
    yet, and gives a probed readable Channel with an empty Bio No words. It
    sends no Request.
  - It Rechecks, through the existing requeue path, every group, bot, user
    and Hidden Channel whose Bio language is unset. After this change every
    probe of those kinds writes one, so an unset Bio language means the
    profile was never read; no deploy date is needed and a second run selects
    nothing. Entries of kind `unknown` are never selected.
  It is indexed in `development.md` beside the other maintenance scripts.
- **The Directory merge script needs no change.** It copies every
  non-generated column it finds at run time, so the new column and users'
  names travel with it.
- **ADR-048 and the glossary are already written.** The ADR's status line and
  ADR-047's both say what supersedes what; nothing in this effort edits them.

## Testing Decisions

- A good test drives the system from its edge and observes what a reader would
  see: Telegram answers a handle with a real page, the probe runs, and the
  Directory read reports the entry. Tests do not call the parser's helpers or
  inspect the probe's payload.
- **The probe seam (backend, the main one).** The existing Handle kind tests
  fake Telegram at the HTTP transport and read entries back through the
  Directory read API. They extend to assert, per kind, the name, Bio, photo
  URL and Bio language the read reports: a readable Channel and a Hidden
  Channel with all three, a group with its name and photo and no Bio, a bot
  with an English Bio read as `en`, a user with all three, a free handle with
  none. The fixtures are the existing stored `kind_*` pages. The user and
  Hidden Channel pages are already synthetic; one of them gets a Bio long
  enough to be placed, the other keeps its short one as the Undetermined case.
- Further cases at the same seam: a Recheck clears the Bio language and the
  next probe writes it again; `biolang:` filters by it, and No words and
  Undetermined are reachable; the Bio language counts leave out their own
  Conditions and leave out users for a reader who does not see internals;
  search never matches a user's name or Bio; a probe of each kind still
  records exactly one Request. The Directory's every-column guard already
  forces the new column through the catalogue, sorting and filtering.
- **The script seam (backend).** Seed rows in the test database, run the
  script's entry point, read the rows back: stored Bios get a Bio language,
  a readable Channel's empty Bio gets No words, an unread entry stays unset,
  the Recheck selects exactly the unread groups, bots, users and Hidden
  Channels and never an `unknown` one, a second run selects nothing, and a dry
  run changes nothing.
- **The UI seam (frontend).** The existing Directory table, panel, bar and
  filter tests: the Bio language column is offered and off by default with its
  tooltip, the panel shows the Bio language after the Language, the dropdown
  sits after Language's with its counts, `biolang:` parses and prints back, and
  a user's row and panel show the name and photo.
- Prior art: the Handle kind tests with Telegram faked at HTTP; the
  Language backfill and relabel script tests; the Directory every-column,
  search and filter tests; the Directory table, panel and bar component tests.
- Every new guard is mutation-checked before it is trusted, with the repo's
  mutation script.

## Out of Scope

- The verified badge, and Telegram's scam and fake labels.
- Classifying the ~737k old `unknown` entries, from forwards or by Recheck.
- A Language for an entry with no sample, read from its name or its Bio. Bio
  language is its own claim and never feeds the Language.
- Reading the Bio language from the name as well as the Bio.
- Caching photos on our side, and refreshing sealed entries to keep photos or
  Bios current.
- A group's online count, and chat ids for Hidden Channels and groups.
- Showing Bio language on cards, or switching its column on by default.
- Any change to who may see a non-Channel kind.

## Further Notes

- A sealed entry's Bio and photo are frozen at its probe; ADR-048 accepts that
  a photo shown for a sealed entry may be years old, and that its URL may die.
- The detector refuses fewer than 20 letters, and many Bios are shorter. How
  often Bio language comes out Undetermined on real Bios was not measured;
  reading staging's stored Bios in the `proto` schema answers it before anyone
  leans on the filter.
- The catch-up Recheck on staging is about 3,060 Requests (2,008 users, 568
  bots, 377 Hidden Channels, 104 groups as of 2026-11-03), run once after this
  change deploys. Production's probe Request kind is off, so production gets
  its profiles through the Directory merge.
