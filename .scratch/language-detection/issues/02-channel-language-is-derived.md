# LANG-02: A Channel's Language is derived from its Posts

**What to build:** The Channels tab shows each Channel's Language once, in one vocabulary, named in
the interface's locale ("Persian", never `pes` beside `Persian`). The Language filter lists each
language once. A Channel's Language follows what it publishes now: it is re-derived whenever
Posts are written to it, so a Channel that changes language is relabelled without anyone
intervening, and a Persian Channel that forwards English news stays Persian. Nothing but the
derivation can write it, and no browser runs detection any more. See
`.scratch/language-detection/spec.md` and ADR-021.

**Blocked by:** LANG-01.

**Status:** ready-for-agent

- [ ] The derivation rule is a pure function over a set of Post Languages that LANG-05 can reuse: among the newest 100 of the Channel's own (not forwarded) Posts carrying a code, the most common code wins, ties go to the newest Post's code, forwarded Posts are used only when there are no own Posts, and the answer is null when nothing qualifies
- [ ] The Post write path re-derives the Language of every Channel a batch touched, and writes the Channel only when the answer changes
- [ ] A Language change reaches the Channels tab through the same freshness mechanism as any other Channel field change
- [ ] The derivation is the only writer of a Channel's Language; the field joins the server-managed Channel fields, so the update route and import strip it
- [ ] A migration sets every existing Channel Language to null (retired vocabulary)
- [ ] The Language detection in sync finalisation, the `langdetect` dependency and the server's name tables are deleted
- [ ] The browser's background detection effect, its helper module and test, and the `franc-min` and `langs` dependencies are deleted
- [ ] The Channel card badge and the Language filter render codes through `Intl.DisplayNames`; the filter's value is the code and its options are sorted by displayed name
- [ ] Tests through the write path cover: majority of own Posts; forwards ignored when own Posts exist and used when none do; null when nothing is readable; a Channel relabelled after a batch in a new Language; a Channel update carrying a Language leaves it unchanged
- [ ] Frontend unit tests cover the grid filter collecting codes and displaying names
