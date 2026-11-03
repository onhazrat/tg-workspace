# TML-03: Artifact undo and Saved views

**What to build:** Deleting a Summary, a Chat, a Tag run or a Discovery report
can be undone, and it comes back whole, its frozen Scope included; starring or
noting one can be undone too. Any Step can be named as a Saved view that keeps
its tab and filters and whichever of its selections, Analysis window and open
tabs the Account chooses, kept on the Account so every browser it signs in to
can apply it. Saved views appear first in the Timeline drawer, most recently
used first, and in the command palette as "Apply Saved view: <name>".

Spec: `.scratch/filter-memory/spec.md` (The undo contract's soft delete,
Saved views; user stories 26, 27, 50 to 57). ADR-049. Glossary: Saved view.
Reference: `prototype/filter-memory`, variant F, where a restore by upsert
lost the frozen Scope.

**Blocked by:** TML-02.

**Status:** ready-for-agent

- [ ] Deleting an Artifact is a soft delete held 7 days; History, the Artifact tabs and every other read never show a soft-deleted Artifact; its `Undo` header restores it unchanged, Scope included; the retention job purges soft-deleted Artifacts after 7 days.
- [ ] A star or a note on a Summary, a Chat, a Tag run or a Discovery report is undoable.
- [ ] A Saved view is a row on the Account holding a name, the chosen parts of a Step's view state, and when it was created and last used. Routes list, create, update (rename, or replace its state) and delete it; each is undoable through the contract and falls under the account isolation guard.
- [ ] Naming a Step (the drawer's star, or `s`) asks for a name and which of the Channel selection, Post selection, Directory selection, Analysis window and open tabs to keep beside the tab and filters.
- [ ] Applying a Saved view is a Step; it restores what it keeps, Live window as Live, drops Channels no longer followed, and says how many it dropped.
- [ ] Saved views can be renamed, updated to the current state and deleted from the drawer, each a Step; they are listed most recently used first and survive sign-out.
- [ ] The command palette lists Saved views as "Apply Saved view: <name>".
- [ ] The parameterized API test gains the Artifact delete, star and note, and every Saved view route; an isolation test shows a second Account never sees or changes another's Saved views.
- [ ] The Playwright spec gains applying a Saved view and undoing an Artifact delete against mocked routes.
