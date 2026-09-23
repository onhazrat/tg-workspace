# LANG-05: Directory entries show a Language instead of an alphabet

**What to build:** Discover's Candidate panel names a Candidate's Language where it named the
alphabet of its sample, so an Operator can tell a Persian Channel from an Arabic one before
following it. A Candidate's Language comes from its sample by the same rule as a Channel's, so a
Candidate and the Channel it becomes once followed agree. Entries that predate this change gain a
Language on their next conclusive probe, inside the Directory refresh window. See
`.scratch/language-detection/spec.md` and ADR-021, which supersedes ADR-015's `script`.

**Blocked by:** LANG-02.

**Status:** resolved

- [x] Sample statistics produce a Language in place of `script`: each sample is read through the LANG-01 module, and the entry's Language comes from the LANG-02 derivation rule (own words first, forwards as fallback)
- [x] The Language is computed at any sample size, including below the minimum that suppresses the rates, as `script` was
- [x] Directory entries gain a nullable Language column and lose `script`, with no backfill; sample rows store no Language
- [x] The Discover API field changes from `script` to `language`; projection guards are updated and the client regenerated
- [x] The panel names the Language through `Intl.DisplayNames`; the alphabet label table is deleted and the tooltip describes a language, not a script
- [x] Tests on the statistics transform cover: a Persian sample yields `fa`, an Arabic sample `ar`, a sample of forwards alone still yields a Language, and a sample below the minimum size still yields one; the write-path test moves from `script` to `language`
- [x] Frontend unit tests cover the panel statistics helper naming a Language
