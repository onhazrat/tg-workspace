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

- [ ] The dismissal table, model and service carry the name Dismissal, through a migration that keeps every existing row
- [ ] Discover's dismiss, restore and Ignored view work exactly as before, and the per-Account dismissal test passes
- [ ] Dismissed is a Directory filter Condition (`is:dismissed` in the text form), and the opening view becomes `not followed and not dismissed and followable`
- [ ] A "Hide dismissed" switch joins Hide followed and Followable only in the pill row, behaving as they do
- [ ] Each row, the panel and the bulk bar offer Dismiss; the confirmation offers Undo and stays up for ten seconds
- [ ] The Directory list reports each row's Dismissed flag; a Dismissal drops the Account's cached totals so the total moves at once
- [ ] Follow is withheld on a dismissed Channel until the Dismissal is taken back, as Discover does
- [ ] The Account can list only its dismissed Channels (the Dismissed Condition) and take a Dismissal back from a row or the panel
- [ ] Dismissing and taking back are writes, refused in a View-as session unless it is elevated
- [ ] The Directory HTTP test module covers a Dismissal hiding a Channel for one Account and not the other, in both the Directory and Discover, the withheld Follow, and taking it back
- [ ] The mocked Playwright journey gains: dismiss a row, see it leave, undo; turn Hide dismissed off and see the row back, dimmed
