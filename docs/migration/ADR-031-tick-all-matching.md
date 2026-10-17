# ADR-031: Tick all is a snapshot up to 10,000 and All matching above it

**Status:** Accepted (2026-10-18). Plan: `docs/directory-select-all-plan.md`.

## Context

The Directory's header checkbox ticks the current page, at most 100 entries.
An Account wants to act on everything a view matches, as Gmail's "Select all
conversations that match this search" does. A view can match hundreds of
thousands of entries (staging's Directory holds about 973k).

Ticks are a per-browser list of handles. Every bulk action (Follow, Dismiss,
Tag, Untag, Boost) sends that list, and ticked Seeds are capped at 10,000
(`MAX_SEEDS`).

## Decision

Once a page is fully ticked and the view matches more, the bulk bar offers to
take in the whole view. How it does so depends on the view's size:

- **10,000 or fewer: a snapshot.** The server returns every matching handle and
  they become Ticks. Nothing downstream changes. They can be Seeds, they keep
  across view changes and reloads, and Dismiss keeps its Undo.
- **More than 10,000: All matching.** The selection is held as the view itself,
  in memory only. Dismiss, Tag, Untag and Boost send the view, and the server
  resolves it at action time and reports the count it acted on. Follow is
  disabled, the selection cannot be Seeds, and Dismiss asks first, with no
  Undo. Any change to the view ends it, and so does unticking a row, which
  leaves that page's Ticks minus the row.

The bulk bar says which of the two happened and why, so the size threshold is
never invisible.

Each existing write takes exactly one of `handles` or `view`. A new route for
the predicate would have needed its own tenancy and View-as checks.

## Alternatives considered

- **Snapshot only, capped.** Rejected, because a view over 10,000 could not be
  tagged or dismissed as a whole, and that is the case the request is about.
- **Predicate only, as Gmail does.** Rejected, because the result could not be
  Seeds, would be lost on reload, and could not be undone. Under 10,000 a
  snapshot loses nothing.
- **Both, offered side by side.** Rejected, because it makes the Account learn
  a distinction that the size already settles.
- **All matching with an exclusion list** for rows unticked afterwards.
  Rejected, because every write route would have to carry a second list, and
  nobody curates 50,000 rows by hand.
- **Freezing the predicate at the click** and refusing if the count moved.
  Rejected, because it refuses for reasons the Account cannot see. The toast's
  count is the truth instead.

## Consequences

- One new read returns a view's handles, refused above 10,000.
- `dismiss`, `tag`, `untag` and `boost` accept `view`, answer 422 when given
  both or neither, and resolve the view through the same scoped Directory query
  as the list, so tenancy and Dismissals apply unchanged.
- Following more than 10,000 Channels at once is impossible by design. Every
  Follow starts a First sync charged to the Account's Telegram Budget.
- The writes run in the request, behind a statement timeout. They move to a
  worker job only if staging measures one over about 20 seconds.
