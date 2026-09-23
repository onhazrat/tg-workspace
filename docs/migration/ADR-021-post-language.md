# ADR-021: A Post has a Language, read on the server by fastText

**Status:** Accepted (2026-09-23). Supersedes the `script` statistic of
[ADR-015](./ADR-015-directory-statistics.md). Spec: `.scratch/language-detection/spec.md`.

## Context

Only a Channel carried a language, and two detectors wrote it. The backend ran `langdetect` over
its 20 newest Posts on sync; the browser ran `franc-min` over a feed read and PUT the answer onto
the shared Channel row. They disagree on vocabulary: `franc` answers `pes`, `arb`, `cmn` and
`uzn`, `langs` has no name for any of them, so staging showed `pes` beside `Persian` (UI audit
D3). The value was written once and never revisited, and the browser path let one Account rewrite
a corpus field every other Account reads.

Posts had no language at all, so the translation job could not tell an English Post from a
Persian one. It sent every untranslated followed Post to the Operator Key, English into English
and the literal placeholder `[photo]` included.

## Decision

**A Post has a Language; a Channel's and a Directory entry's are derived, never set.** Every Post
is read once, on the server, when it is written and again when its text changes. A Channel's
Language is the most common among its own recent Posts, counting forwards only when it has none
of its own, recomputed on every sync. A Directory entry's is derived the same way from its sample
and replaces `script`, the alphabet tally ADR-015 chose because the backend held no detection
library. It holds one now.

**Three states, not two.** Unread (the backfill walk's queue), no words (`zxx`: a media-only Post,
emoji) and undetermined (`und`: too short, or scored under one global floor). Only "no words" is
skipped by translation; undetermined is still translated, because it is where Finglish lands.

**Stored as an ISO 639 code**, named at display time by `Intl.DisplayNames`. The Translation
language setting stays a name, mapped to a code for the one comparison that needs it.

**fastText `lid.176` (lite), through `fast-langdetect`.** Measured on 1,242 real Posts from 17
public Channels, parsed by our own scraper:

| | langdetect | lingua (15 langs) | fastText lite |
|---|---|---|---|
| Full Posts | 99.4% | 98.7% | 99.6% |
| First two words | 76.2% | 94.0% | 94.3% |
| Posts/s, one thread | ~1,000 | 3,755 | 22,193 |
| Kurdish Sorani, Pashto, Tajik | no | no (Sorani reads as Arabic) | Sorani, Tajik |

## Considered options

- **`lingua`**, which calls itself the most accurate detector for short text. It was close on our
  corpus, six times slower, less well calibrated (a 0.7 floor cost it a third of its right
  answers), and it cannot name Sorani, Pashto or Tajik, which Iranian Telegram carries.
- **An LLM per Post**, as Discourse does. One call per Post across a 4.68M-Post corpus, on the
  Operator Key, to save a few percent on two-word Posts.
- **User-declared language**, as Mastodon chose after removing CLD3. Our Posts are scraped, so
  there is no author to ask.

## Consequences

- The model weights are CC BY-SA 3.0. They ship inside the pip wheel, not this repository, and the
  README carries the attribution.
- Finglish (Persian in Latin letters) is detected confidently wrong, as Hungarian or Italian; no
  floor catches it. A per-Follow override is the known remedy and is deferred until a real Channel
  needs it.
- Existing Posts are read by a scheduled walk, newest first, because staging is not ours to run
  scripts on. Directory entries fill in on their next conclusive probe, inside
  `directoryRefreshDays`.
