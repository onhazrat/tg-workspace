# Language filter states plan

Every Language filter (Posts, Channels, Directory) lists every Language a row can have, including
Undetermined, No words and Not read yet, and lets the user filter on each. Decisions from a
grilling session on 2026-10-15; the rule change is recorded in
[ADR-021](./migration/ADR-021-post-language.md#revised-2026-10-15-a-channel-can-be-undetermined-or-have-no-words)
and the vocabulary in `CONTEXT.md` under **Language**.

## Decisions

1. **Channel rule falls back.** `derive_language` returns `und` or `zxx` when no Post carries a
   code, decided by the same Posts that would have decided a code (own Posts; forwards only when
   there are none): `und` if any of them is, `zxx` otherwise. `null` means only "not read yet".
   Applies to Channels and Directory entries through the one function.
2. **Vocabulary.** `zxx` is "No words" (was "No text" in the UI), `und` is "Undetermined",
   `null` is "Not read yet".
3. **One shared module** for how a Language is shown, `lib/language-name.ts`: `languageValue`
   turns a stored Language into the value a Condition names (the code, or `null`),
   `languageLabel` names it, and the value itself is the hint, for every facet row and picker
   option in all three tabs; `components/LanguageName.tsx`
   `<LanguageName code />` renders the same thing (label, dimmed value) for the Channel card badge
   and the Directory Lang cell. `FacetMenu` and `ConditionPicker` stay string-based.
4. **Not read yet is filterable in all three tabs**, written `lang:null`. Each backend's single
   `LanguageCond` branch and the Channels client filter map it to `IS NULL`. Its hint is `null`.
5. **One sort order** in all three menus, from one `sortLanguages`: real Languages by count
   descending, ties and the uncounted case by name; then Undetermined, No words, Not read yet,
   fixed, at the bottom. The server's order is ignored.
6. **No special case for null in display.** The Channel card badge and the Directory cell show
   "Not read yet `null`" like any other state.
7. **Backfill by script**: `backend/scripts/relabel_languages.py --dry-run` re-derives every
   Channel from its Posts and every Directory entry from its stored samples, no Telegram
   Requests. Run on staging and production after deploy, each run approved by the operator.

## Work

- [x] Backend: fallback in `derive_language`; test the meme-Channel scenario and the
      forwards-only scenario.
- [x] Backend: `lang:null` → `IS NULL` in `post_filters.py` and `directory_reads.py`; Posts
      facet counts include the `null` bucket (`posts.py`, today `IS NOT NULL`).
- [x] Backend: `relabel_languages.py` with `--dry-run`; indexed in `development.md`.
- [x] Frontend: shared language module (`languageValue`, `languageLabel`, `sortLanguages`,
      `NOT_READ`, `<LanguageName>`); rename "No text" to "No words".
- [x] Frontend: Posts, Channels and Directory facets and pickers use it, including the `null`
      row; Channels client filter handles `lang:null`.
- [x] Frontend: Channel card badge and Directory Lang cell use `<LanguageName>`.
- [x] Unit tests for the shared module; mutation-test the sort and the `null` mapping.
- [ ] After deploy: dry-run then run the script on staging, then production (approval each).
