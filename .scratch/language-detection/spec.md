# Spec: Language detection

**Status:** ready-for-agent

Decided in [ADR-021](../../docs/migration/ADR-021-post-language.md), which supersedes the `script`
statistic of ADR-015. Ticket ids use the prefix `LANG`.

## Problem Statement

The Channels tab labels one language two ways. On staging, `pes` sits beside `Persian` and `arb`
beside `Arabic` (UI audit D3), and the Language filter offers both as separate choices, so
filtering by `Persian` silently drops every Channel labelled `pes`. The cause is two detectors
writing one field: the backend on sync, and every open browser, which reads a feed page per
unlabelled Channel and writes its own answer onto the shared Channel. One Account's browser
therefore rewrites a label every other Account sees.

A Channel's label is written once and never revisited. A wrong first guess, or a Channel whose
first Posts happened to be forwards or captionless photos, stays wrong for good.

Posts have no Language at all, so translation cannot tell an English Post from a Persian one. The
Operator Key pays to translate English Posts into English, and to translate the literal text
`[photo]` that a captionless photo is stored as.

Discover names the alphabet a Candidate's sample is written in, not its Language. A Persian
Channel and an Arabic one both read "Arabic / Persian", which is the distinction an Operator
deciding whether to follow most needs.

## Solution

Every Post has a Language, read from its own words on the server when it is written and again
whenever its words change. A Channel's Language and a Directory entry's Language are derived from
Posts, never set, so they correct themselves as Posts arrive. One detector answers everywhere,
in one vocabulary (an ISO 639 code), and the interface names it in the reader's own locale.

Translation skips Posts already in the Translation language and Posts with no words, in the
scheduled job and on the on-demand Translate button alike. Discover shows a Candidate's Language
where it showed an alphabet. Posts stored before this change are read by a scheduled walk,
newest first, without anyone running anything by hand.

## User Stories

1. As an Account, I want every Channel's Language shown in one vocabulary, so that the same language never appears under two labels.
2. As an Account, I want the Language filter on the Channels tab to list each language once, so that filtering by Persian finds every Persian Channel.
3. As an Account, I want Language names shown in my interface's locale, so that I read "Persian" (or its equivalent in my locale) rather than a code.
4. As an Account, I want a Channel's Language to follow what it actually publishes now, so that a Channel that changes language is relabelled without anyone intervening.
5. As an Account, I want a Channel's Language to ignore the Posts it merely forwards when it has words of its own, so that a Persian Channel forwarding English news is still labelled Persian.
6. As an Account, I want a Channel that only forwards to still get a Language from what it forwards, so that a pure re-poster is not left unlabelled.
7. As an Account, I want a Channel with no readable Posts yet to show no Language, so that an empty label is never mistaken for a wrong one.
8. As an Account, I want captionless photos, videos and stickers never to count toward a Channel's Language, so that a media-heavy Channel is not labelled English because of placeholder text.
9. As an Account, I want links, @mentions and hashtag markers ignored when a Post is read, so that a Persian Post full of English URLs is still read as Persian.
10. As an Account, I want my browser never to write a Channel's Language, so that what I see cannot be overwritten by another Account's browser.
11. As an Account, I want no background language work running in my browser, so that opening the app no longer fires a feed read per unlabelled Channel.
12. As an Account, I want each Post to carry its Language, so that the interface can tell whether a Post needs translating.
13. As an Account, I want the Translate button hidden on a Post already in the Translation language, so that I am not offered a translation into the language I am reading.
14. As an Account, I want the Translate button hidden on a Post with no words, so that I am not offered a translation of a photo.
15. As an Account, I want the Translate button kept on a Post whose Language could not be determined, so that Finglish and very short Posts can still be translated.
16. As an Account, I want a Post whose text was edited on Telegram to be read again, so that its Language follows its current words.
17. As an Operator, I want the translation job to skip Posts already in the Translation language, so that the Operator Key stops paying to translate English into English.
18. As an Operator, I want the translation job to skip Posts with no words, so that the Operator Key stops paying to translate `[photo]`.
19. As an Operator, I want the translation job to keep translating undetermined Posts, so that the Posts readers most need translated are not the ones dropped.
20. As an Operator, I want a Translation language outside the known list to fall back to translating as before, so that an unusual setting degrades to today's behaviour rather than skipping everything.
21. As an Operator, I want Posts stored before this change read by a scheduled walk, so that the backfill needs no script run by hand on a deployment.
22. As an Operator, I want the walk to read the newest Posts first, so that the Posts translation and the Channel labels depend on are correct soonest.
23. As an Operator, I want the walk to take a bounded batch per tick, so that it never competes with sync for the database.
24. As an Operator, I want the batch size to be a documented setting, so that I can speed the walk up or slow it down without a code change.
25. As an Operator, I want a caught-up walk to cost next to nothing, so that it can run forever after the backfill finishes.
26. As an Operator, I want the walk to relabel the Channels whose Posts it read, so that the Channels tab fills in as the backfill proceeds.
27. As an Operator, I want the old Channel labels discarded rather than translated, so that no value from the retired detectors survives.
28. As an Operator, I want an import never to trust a Language carried in the document, so that every Language in the deployment came from the same detector.
29. As an Operator, I want a Channel's Language unwritable through the Channel update route, so that no client can set a derived value.
30. As an Operator, I want detection to run without any network call or model download at runtime, so that a deployment behind a restrictive network still reads Posts.
31. As an Operator, I want the detector's memory footprint to stay small in both the API and the Sync worker, so that the 8 GB staging server has headroom.
32. As an Operator, I want the detector's model licence attributed in the README, so that publishing the project stays within its terms.
33. As an Operator, I want Discover to show a Candidate's Language instead of its alphabet, so that I can tell a Persian Channel from an Arabic one before following it.
34. As an Operator, I want a Candidate's Language derived by the same rule as a Channel's, so that a Candidate and the Channel it becomes once followed agree.
35. As an Operator, I want a Candidate's Language shown even when its sample is small, so that a preview page of three Persian Posts still says Persian.
36. As an Operator, I want Directory entries that predate this change to gain a Language on their next conclusive probe, so that no special backfill is needed for them.
37. As an Operator, I want no alphabet label left anywhere once Language replaces it, so that one panel never speaks two vocabularies.
38. As a maintainer, I want one module to answer "what Language is this text in", so that the Post path, the walk and the Directory cannot drift apart.
39. As a maintainer, I want the definition of "a Post's own words" shared by Post reading and Directory statistics, so that a captionless photo means the same thing in both.
40. As a maintainer, I want the retired detectors and their dependencies deleted rather than left beside the new one, so that nobody wires them back in.

## Implementation Decisions

**One Language-reading module, a pure transform.** It takes a Post's own words and answers exactly
one of: an ISO 639 code, `zxx` (no words), or `und` (words it cannot place). It is declared as a
pure transform in the service-kinds inventory. Behind it is fastText's `lid.176` lite model through
`fast-langdetect`, loaded once per process on first use, with no runtime download. The library's
default input limit silently truncates to 80 characters and must be raised. Newlines are flattened
before detection.

**What counts as a Post's own words.** A Post with media and no caption has no words: its stored
text is a synthesised placeholder. That rule already exists for Directory samples; it moves to one
shared place and both callers use it. Before detection, URLs and @mentions are removed, hashtag
markers are dropped with their words kept, and characters that are neither letters nor spacing are
dropped. Text left with fewer than 20 letters is `und`, as is a top score below 0.5. Both are code
constants, not settings: one global floor, not one per language (ADR-021).

**Codes are fastText's labels, stored as they come.** That is ISO 639-1 where one exists and a
longer code where it does not (`ckb` for Sorani). Nothing on the server maps codes to names. The
interface names them with the browser's `Intl.DisplayNames` in the interface locale.

**Schema.** Posts gain a nullable Language column: null means not yet read, `zxx` no words, `und`
undetermined, anything else a code. A partial index covers only unread Posts, newest first, in the
same shape as the pending-references index. The migration adds the column and index, writes no
Post rows, and sets every existing Channel Language to null, since those values belong to the
retired vocabulary. Directory entries gain a nullable Language column and lose `script`; no
backfill.

**The Post write path reads Posts.** A new Post is read as it is written. An existing Post is read
again only when its text or media changed, using the same conditional pattern as reference
extraction's pending flag. An unchanged Post is left alone, because sync rewrites the newest page
of every followed Channel on every run. After writing a batch, the write path re-derives the
Language of every Channel the batch touched. Sync, import and the bulk route all write through it,
so all three get this without their own code. An import's document Language is ignored.

**Deriving a Channel's Language.** Take the newest 100 of the Channel's own Posts (not forwarded)
that carry a code rather than `zxx`, `und` or null. Its Language is the most common code among
them, with ties going to the code of the newest Post among the tied. If it has none, apply the same
rule to its forwarded Posts. If that finds nothing either, its Language is null. The Channel is
written only when the answer changes, and a change must reach the Channels tab through the same
freshness mechanism as any other Channel field. The derivation lives beside the reading module and
is the only writer of a Channel's Language.

**A Channel's Language is server-managed.** It joins the set of Channel fields that the update
route and import strip, so no client can write it. The Language detection that sync finalisation
runs today is deleted, along with `langdetect` and the server's name tables.

**The walk.** A scheduled job on the Sync worker reads a bounded batch of unread Posts per tick,
newest first, through the partial index. It writes their Languages in batched updates and then
re-derives the touched Channels through the same function the write path uses. Batch size is an
integer setting documented in `.env.example`, with a default sized like the harvest and
reference-extraction batches. A caught-up tick is one probe of an empty partial index. The update
volume leaves dead tuples that autovacuum reclaims at the walk's pace; no manual `VACUUM` step.

**Translation.** The scheduled job considers only Posts that have been read. It skips those whose
Language is `zxx` or equals the Translation language's code, and keeps `und`. The Translation
language setting stays a name. A map from the offered names to codes serves the comparison, and a
name missing from the map disables the skip rather than skipping everything. The backend map and
the frontend's list of offered Translation languages must stay equal, and a backend guard reads
the frontend list to enforce it.

**The Post API.** Feed and lookup responses carry each Post's Language as a nullable string. The
projection guards are updated and the generated client regenerated.

**The Translate button.** It is hidden when the Post's Language is `zxx` or equals the Translation
language's code, and shown otherwise, including for `und` and unread Posts.

**The browser stops detecting.** The background detection effect, its helper module and test, and
the `franc-min` and `langs` dependencies are deleted. The Channel card badge and the Language
filter render codes through `Intl.DisplayNames`. The filter's value is the code, and its options
are sorted by displayed name.

**Directory entries.** Sample statistics produce a Language in place of `script`. It is derived
from the sample with the Channel rule (own words first, forwards as fallback) through the same
reading module, and computed at any sample size, as `script` was. Sample rows store no Language.
The Discover API field changes from `script` to `language`. The panel names it through
`Intl.DisplayNames`, the alphabet label table is deleted, and the tooltip describes a language
rather than a script.

**Licence.** The README attributes the `lid.176` model under CC BY-SA 3.0. The weights ship inside
the pip wheel, not this repository.

## Testing Decisions

A good test here feeds real words through a real seam and asserts what an Account or Operator
would observe: a row's Language, which Posts reach the Provider, what the panel says. Tests use
the real bundled model, which is deterministic and fast. Fixtures are clear-cut sentences, not
borderline two-word cases, so a model update cannot flake them. Every new guard is mutation-tested
before it is trusted.

- **The Post write path**, asserted on database rows. Covered: a new Post gets its code, a
  captionless photo and an emoji-only Post get `zxx`, a one-word Post gets `und`, an unchanged
  re-scrape leaves the Language untouched, an edited Post is read again, and an import's Language
  is ignored. Channel derivation is asserted through the same seam: majority of own Posts, forwards
  ignored when own Posts exist and used when none do, null when nothing is readable, and a Channel
  relabelled after a batch of Posts in a new Language. Prior art: the reference-extraction tests
  and the harvest job tests.
- **The walk**: newest first, bounded by the batch setting, touched Channels relabelled, and a
  caught-up tick that finds nothing. The `.env.example` defaults guard covers the new integer.
- **The translation job with a fake Provider**, asserting which Posts reach it: same-language and
  no-words Posts never do, undetermined Posts do, unread Posts wait, and an unmapped Translation
  language translates as before. Prior art: the LLM log provenance tests' fake Provider.
- **The Directory statistics transform**: a Persian sample yields `fa`, an Arabic sample `ar`, a
  sample of forwards alone still yields a Language, and a sample below the minimum size still
  yields one. The write-path test for Directory statistics moves from `script` to `language`.
  Prior art: the existing Directory statistics tests.
- **Guards touched**: the service-kinds inventory (new module), the response projection tests
  (Post and Discover shapes), the server-managed Channel field set, the hand-written frontend types
  conformance, and a new guard holding the backend's Translation-language map equal to the
  frontend's list.
- **Frontend unit tests** extend the existing ones: the panel statistics helper names a Language
  and no longer knows scripts, the grid filter collects codes and shows names, and the Translate
  button's visibility rule covers `zxx`, the same Language, `und` and unread.

## Out of Scope

- A per-Follow Language override. It is the known remedy for Finglish, which is detected
  confidently wrong, and is deferred until a real Channel needs it.
- Filtering Posts by Language as part of the Scope.
- Showing a Channel as mixed, or the share of its top Language.
- Moving the Translation language or Output language settings from names to codes.
- Per-language confidence thresholds.
- Language on individual Directory sample rows.
- Language-aware search (per-language stemming or analysers).
- LLM-based detection.

## Further Notes

The detector choice rests on a benchmark of 1,242 real Posts from 17 public Channels, parsed by
this project's own scraper, summarised in ADR-021. On full-length Posts every candidate scored
above 98%. The differences were short Posts, regional languages (Sorani, Pashto, Tajik), speed and
calibration, and fastText's lite model led on all four.

Translation now waits for a Post to be read. That only affects Posts stored before this change,
because new Posts are read as they are written, and the walk reaches the newest of them within its
first ticks.
