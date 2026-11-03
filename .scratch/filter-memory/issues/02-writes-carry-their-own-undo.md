# TML-02: Writes carry their own undo

**What to build:** A write the workspace sends becomes a Step too, and undoing
it takes the write back on the server. Moving a Channel to another Setting
group, tagging Channels, renaming or deleting a Tag, Dismissing an entry or
All matching, a Follow or an unfollow, a Setting, a Setting group: each comes
back with one undo, and Redo sends it again. A write that cannot be taken back
(a sync, an AI run, a Publication, a Tag merge) appears on the Timeline marked
as such, and undo passes over it with a toast naming it. When the same rows
changed since, for instance on another device, undo is refused with "changed
since" and passed over the same way. Every write from a click shows
"<what it did> · Undo"; the Dismissal and Keyboard mode toasts undo their
Step; confirm dialogs stay only before writes that cannot be undone.

Spec: `.scratch/filter-memory/spec.md` (The undo contract; user stories 17 to
25, 28 to 37, 58). ADR-049. Reference: `prototype/filter-memory`, variant F,
whose browser-built inverses this replaces; its Prototype reference section
lists what the staging checks found.

**Blocked by:** TML-01.

**Status:** ready-for-agent

- [ ] Every mounted user-facing write route is classified undoable or cannot-undo in a route inventory, and a guard fails, in both directions, on a route that is mounted but unclassified or classified but not mounted, and on a route whose response lacks the `Undo` header its class promises. Mutation-checked.
- [ ] An undoable route builds its inverse in the write's own transaction and returns it in the `Undo` response header with a fingerprint of the rows the write left; the header is exposed for CORS. A cannot-undo route returns an `Undo` header saying so.
- [ ] Sending an inverse whose fingerprint no longer matches answers 409 "changed since"; an inverse is itself a write whose `Undo` header is the Redo.
- [ ] Inverses exist for: Follow and unfollow (the Follow's Setting group and follow date come back, the server-managed Channel fields stay out); bulk Follow (a dedicated undo that cancels a running job and unfollows what it followed); moves between Setting groups (each Channel to its own group); Tags on Channels; Tag rename (a rename onto an existing Tag's name is a merge and cannot be undone) and Tag delete; Dismissal and take-back, for entries and All matching; both Settings APIs; Setting group create, edit and delete. Operator-only tools are classified cannot-undo.
- [ ] The two API transports read the `Undo` header; the write becomes a Step, and a view change within 2.5 seconds joins that write's Step. Writes sent by undo, redo or a view restore are not recorded.
- [ ] Undo and redo send the Step's writes, pass over not-undoable and refused Steps with one toast naming them, and refresh what the write changed.
- [ ] Every recorded write from a click shows a toast with its label and an Undo; the existing Dismissal and Keyboard mode toasts undo through the Timeline; confirm dialogs before undoable writes are removed and kept before cannot-undo ones.
- [ ] One parameterized API test covers every undoable route: read, write, send the inverse, read equals the first read; change the rows another way, send the inverse, 409; send the undo's own inverse, read equals the state after the write.
- [ ] The Playwright spec from TML-01 gains a mocked write undone by Cmd+Z and by its toast.
