# DIR-06: Dismissal everywhere

**What to build:** An Account rejects a Channel once and stops seeing it wherever it looks for
Channels to follow. A Dismissal made in the Directory hides the Channel in Discovery reports too,
and one made in Discover hides it here. The Account can list its Dismissals and take any back.
See `.scratch/directory-tab/spec.md`: user stories 91 to 96, the Dismissed half of 3 and 55, the
Hide dismissed switch of 43, Dismiss in the bulk bar of 88, the Dismissal half of 112, and the
implementation decisions on Dismissal and the tab. The glossary term is **Dismissal**; "ignore" is on its avoid list.

**Blocked by:** DIR-03

**Status:** ready-for-agent

Start with the rename, as a prefactor in its own commit: Discover's dismissal table, model and
service take the glossary's name, and every inventory that lists them follows: the tenancy seam,
the export omissions (a Dismissal is deliberately not exported, and keeps that reason) and the test
cleanup inventory. Discover's behaviour and its wire
contract do not change, and its existing tests pass unchanged except for names. Then the Directory
work. The per-Account key stays exactly as it is.

- [x] The dismissal table, model and service carry the name Dismissal, through a migration that keeps every existing row
- [x] Discover's dismiss, restore and Ignored view work exactly as before, and the per-Account dismissal test passes
- [x] Dismissed is a Directory filter Condition (`is:dismissed` in the text form), and the opening view becomes `not followed and not dismissed and followable`
- [x] A "Hide dismissed" switch joins Hide followed and Followable only in the pill row, behaving as they do
- [x] Each row, the panel and the bulk bar offer Dismiss; the confirmation offers Undo and stays up for ten seconds
- [x] The Directory list reports each row's Dismissed flag; a Dismissal drops the Account's cached totals so the total moves at once
- [x] Follow is withheld on a dismissed Channel until the Dismissal is taken back, as Discover does
- [x] The Account can list only its dismissed Channels (the Dismissed Condition) and take a Dismissal back from a row or the panel
- [x] Dismissing and taking back are writes, refused in a View-as session unless it is elevated
- [x] The Directory HTTP test module covers a Dismissal hiding a Channel for one Account and not the other, in both the Directory and Discover, the withheld Follow, and taking it back
- [x] The mocked Playwright journey gains: dismiss a row, see it leave, undo; turn Hide dismissed off and see the row back, dimmed

## Comments

- **Names.** Table `tg_dismissals` (migration `c2d8e4a61f07`, a rename of table, primary key, foreign key and index, so every row stays), model `Dismissal`, service `services/dismissals.py` with `dismissed_handles`, `list_dismissals`, `dismiss_channels`, `take_back_dismissals`. The Discover routes (`/data/discover/ignored`), their operation ids and wire fields (`isIgnored`, `ignored`, `removed`) are unchanged, as the ticket asks; renaming them is a wire change for a later ticket if wanted.
- **No new route.** The Directory dismisses through Discover's `POST`/`DELETE /data/discover/ignored` and its `useDiscoverIgnoreMutation`, which now also refreshes the Directory's queries. Being plain writes, they are refused by read-only View-as and allowed when elevated with no new inventory entry.
- **"Drops the cached totals".** Done by key rather than by eviction: a view that reads the Dismissed Condition carries a hash of the Account's Dismissals in its totals key, so a Dismissal or a take-back moves the total on the next read, and a view that does not read the Condition keeps its cache (its total cannot change). No write path reaches into the read model's cache.
- **Withheld Follow on the server.** A bulk follow sent with `directory` (only the Directory sends it) drops the Account's dismissed Channels and answers 409 `"Every channel sent is dismissed; take the Dismissal back first"` when none is left. Discover's follow, sent without `directory`, is untouched. In the UI a dismissed row and panel show Take back in place of Follow.
- **Dismiss clears the ticks it dismissed**; Undo does not re-tick them.
- The Playwright steps are a separate short test (`dismiss a row, undo, and see it dimmed with Hide dismissed off`), per the lead's note that the journey is near CI's time budget; the journey only changed its opening-view assertion.
