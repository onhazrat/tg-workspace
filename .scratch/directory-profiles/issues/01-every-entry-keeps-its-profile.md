# PRF-01: Every Directory entry keeps its profile and a Bio language

**What to build:** A probe keeps the name, Bio and photo the page Telegram serves
shows, for every Handle kind, users included, and writes a Bio language beside
every Bio it writes. The Directory shows Bio language the way it shows Language:
a column, a panel measure, a dropdown with per-language counts and a `biolang:`
filter Condition. Users stay behind the gate that already hides every
non-Channel kind. A one-off script catches up the existing data: it reads the
Bio language of every Bio already stored, and Rechecks once every entry HKD-01
sealed without its profile. The spec is `.scratch/directory-profiles/spec.md`;
the decision record is ADR-048; the terms are Bio and Bio language in
`GLOSSARY.md`.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A Hidden Channel's probe stores its Bio, read from the description its `t.me/<handle>` page shows under the name, and its photo.
- [x] A group's, a bot's and a user's probe store the name, Bio and photo the page shows; a user's name is no longer dropped.
- [x] A free handle stores no name, Bio or photo; Telegram's "If you have Telegram" and "You can view and join" boilerplate is never stored as a Bio.
- [x] A readable Channel's name, Bio and photo are stored as before.
- [x] Every probe still records exactly one Request.
- [x] A new nullable Bio language column holds a Language code, No words, Undetermined, or nothing for not read yet; an Alembic revision adds it.
- [x] The Bio language is read from the Bio alone by the existing Language reader, with its thresholds unchanged: an empty Bio is No words, a short or unplaceable one Undetermined.
- [x] Wherever the Bio is written, by a probe or by a followed Channel's sync, the Bio language is written beside it; a free handle and an `unknown` page get none.
- [x] A Recheck clears the Bio language with the Bio, and the next probe writes it again.
- [x] The Directory list and panel reads carry the Bio language.
- [x] The column catalogue offers a public Bio language column, off by default and sorted as words.
- [x] `biolang:<code>` filters by Bio language and accepts the values and aliases `lang:` does.
- [x] The list response carries per-Bio-language counts that leave out their own Conditions and follow the every-kind gate, as the Language counts do.
- [x] Users, with their name, Bio, photo and Bio language, appear only in the every-kind view of a reader who sees internals; search, which indexes Channels only, never matches a user's name or Bio.
- [x] The table offers a "Bio lang" column whose tooltip says it is read from the Bio.
- [x] The panel shows the Bio language after the Language.
- [x] The bar shows a "Bio language" dropdown with counts after the Language one.
- [x] Cards show no Bio language.
- [x] A one-off maintenance script, indexed in `development.md`, reads the Bio language of every stored Bio that has none, and gives a probed readable Channel's empty Bio No words, sending no Request.
- [x] The same script Rechecks every group, bot, user and Hidden Channel whose Bio language is unset, never an `unknown` entry, so a second run selects nothing.
- [x] `--dry-run` prints both counts and changes nothing.
- [x] The Handle kind probe tests, with Telegram faked at HTTP and the stored `kind_*` pages, assert each kind's name, Bio, photo and Bio language through the Directory read API. One synthetic fixture carries a Bio long enough to be placed, and the other keeps a short one as the Undetermined case.
- [x] A script test seeds rows, runs the entry point and reads the rows back, covering both steps, a second run and a dry run.
- [x] The Directory table, panel, bar and filter tests cover the column, the panel measure, the dropdown and the `biolang:` parse.
- [x] Every new guard is mutation-checked, and the commit body carries the `Mutation-checked:` line.

## Comments

- 2026-11-03: implemented on `claude/entity-data-enrichment-31a52e` and merged into `main` in
  ab9e8a7a (#273). Search indexes Channels only, so no reader finds a user by name or Bio; the
  spec's first draft assumed internals readers could (spec and ADR-048 corrected in the same PR).
  The catch-up ran on staging the same day: 731,814 Bio languages read and 13,760 Rechecks
  queued, 10,319 of them Hidden Channels from RQS-13 rather than HKD-01. Production needs no
  run; `merge-directory.sh` carries the column.
