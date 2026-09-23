# LANG-02: A Channel's Language is derived from its Posts

**What to build:** The Channels tab shows each Channel's Language once, in one vocabulary, named in
the interface's locale ("Persian", never `pes` beside `Persian`). The Language filter lists each
language once. A Channel's Language follows what it publishes now: it is re-derived whenever
Posts are written to it, so a Channel that changes language is relabelled without anyone
intervening, and a Persian Channel that forwards English news stays Persian. Nothing but the
derivation can write it, and no browser runs detection any more. See
`.scratch/language-detection/spec.md` and ADR-021.

**Blocked by:** LANG-01.

**Status:** resolved

- [x] The derivation rule is a pure function over a set of Post Languages that LANG-05 can reuse: among the newest 100 of the Channel's own (not forwarded) Posts carrying a code, the most common code wins, ties go to the newest Post's code, forwarded Posts are used only when there are no own Posts, and the answer is null when nothing qualifies
- [x] The Post write path re-derives the Language of every Channel a batch touched, and writes the Channel only when the answer changes
- [x] A Language change reaches the Channels tab through the same freshness mechanism as any other Channel field change
- [x] The derivation is the only writer of a Channel's Language; the field joins the server-managed Channel fields, so the update route and import strip it
- [x] A migration sets every existing Channel Language to null (retired vocabulary)
- [x] The Language detection in sync finalisation, the `langdetect` dependency and the server's name tables are deleted
- [x] The browser's background detection effect, its helper module and test, and the `franc-min` and `langs` dependencies are deleted
- [x] The Channel card badge and the Language filter render codes through `Intl.DisplayNames`; the filter's value is the code and its options are sorted by displayed name
- [x] Tests through the write path cover: majority of own Posts; forwards ignored when own Posts exist and used when none do; null when nothing is readable; a Channel relabelled after a batch in a new Language; a Channel update carrying a Language leaves it unchanged
- [x] Frontend unit tests cover the grid filter collecting codes and displaying names

## Comments

Delivered on branch `worktree-lang-02-channel-language`. Where it differs from the text above:

- The update route **refuses** a Language (400) rather than stripping it: joining
  `SERVER_MANAGED_CHANNEL_FIELDS` is what the claim columns already do, and a silent strip would
  hide a client still trying to write it. The browser strips `language` in `channelWritePayload`
  so its own edits never trip it. Import strips, as before.
- `relabel_channels` lives in `services/channels.py`, the Channel aggregate; the rule itself,
  `derive_language`, is the pure function beside `read_language` that LANG-05 reuses.
- The relabel reads a Channel's newest 1,000 Posts and hands them to `derive_language`, rather
  than filtering for 100 coded own Posts in SQL. Filtering would walk the whole history of any
  Channel with fewer than 100 of them, which until LANG-03's walk is nearly every Channel on
  staging, on every sync page. Known ceiling, marked `ponytail:` in `channels.py`: a Channel
  whose readable own Posts are under 10% is judged on fewer than 100.
- `POST /data/import` follows the handles its Posts name *before* writing them, so a Channel the
  import creates is labelled too, and it moves the `channels` etag after its one commit instead
  of holding the row lock through the remaining sections (`announce_relabels=False`).
