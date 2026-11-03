# ADR-049: A write carries its own undo, and the server checks before undoing

**Status:** Accepted (2026-11-03). Decided in a grilling session after the
filter-memory prototype (variant F), which built every undo in the browser.

## Context

The Timeline lets an Account undo any Step, and many Steps sent a write:
a Follow, a Dismissal, a Tag, a Setting, a Setting group, a star or note on an
Artifact, a delete. To undo a write, something has to know what it changed and
how to put that back.

The prototype did it in the browser: one rule per route read the before-state,
let the write through, and stored the inverse request. Checked on staging, two
of its rules were wrong in ways only the server knew. A re-follow was refused
because `language` and `telegramChatId` are server-managed, and a deleted
Artifact came back without its frozen Scope, which only a submit can set.

## Decision

- Every user-facing write route returns, in its response, the request that
  takes it back, built in the same transaction from the rows it changed. A
  route whose write cannot be taken back (a sync, an AI run, a Publication, a
  Tag merge) says so instead.
- That inverse also carries the state the write left. Undo sends it, and the
  server refuses with "changed since" when the rows no longer match, for
  instance after another device changed them. Redo works the same way in
  reverse. Undo passes over a refused Step as it does a can't-undo one.
- The inverse travels in an `Undo` response header, so no response body
  changes shape.
- Deleting an Artifact becomes a soft delete held 7 days, the Timeline's
  reach, so its inverse is a small restore. Sending the whole record back
  would lose the frozen Scope, which only a submit sets.
- The browser keeps the Timeline (per browser tab) and stores the inverses
  without reading or understanding them.
- A guard fails when a user-facing write route neither returns an inverse nor
  declares itself can't-undo.

## Consequences

Every write route grows an undo half, tested with it. An inverse is only as
good as the moment it was built: undo after a reload still works, but only
while the rows it names are as the write left them. A Saved view is not an
inverse and does not depend on this.

## Alternatives rejected

- **Rules in the browser** (the prototype): no backend change, but each rule
  re-derives what the server already knows, breaks silently when a route
  changes, and leaves a race between its read and the write.
- **An undo log on the server, per Account**: undo by Step id, nothing stored
  in the browser. It pays off only if the Timeline lives on the server, and it
  lives per browser tab because most of a Step is view state of that tab.
- **Undo overwrites whatever is there**: simpler, but undoing on the desktop
  would silently wipe a change made on the phone since.
