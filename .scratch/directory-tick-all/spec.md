# Directory: tick all that match

Status: implemented on branch claude/directory-select-all-filters-31166f (see "As built" in the plan)

Ticket prefix: `DTA`.

Settled in one grilling session on 2026-10-18. The decision record is
`docs/directory-select-all-plan.md`, and the rationale is
`docs/adr/ADR-031-tick-all-matching.md`. The terms **Tick**, **Seed** and
**All matching** are defined in `CONTEXT.md`.

## Problem Statement

The Directory's header checkbox ticks only the current page, at most 100
entries. An Account that has narrowed the Directory to a few thousand entries
(every Russian-language channel cited by five or more of its Follows, say)
can only act on them a page at a time: tick the page, Tag, turn the page,
repeat. A view of 48,000 entries is out of reach entirely. Gmail solved this
with "Select all conversations that match this search", and the Directory has
nothing like it.

## Solution

Once the header checkbox has ticked the whole page and the view matches more,
the bulk bar offers to take in every entry the view matches.

When the view matches 10,000 or fewer, the click turns every matching entry
into a Tick. From then on they are ordinary Ticks: they survive a filter change
and a reload, they can be Seeds, and every bulk action works as it does today.

When the view matches more than 10,000, the click enters **All matching**. The
selection is the view itself, held only until the view changes. Dismiss, Tag,
Untag and Boost act on every entry the view matches when the button is
pressed, and the confirmation reports how many they reached. Follow is off,
and so is using the selection as Seeds. Dismiss asks first, because it cannot
be undone at that size. The bulk bar says which of the two modes happened and
why, so the 10,000 line is never a surprise.

## User Stories

1. As an Account, I want the header checkbox to keep ticking only the current page, so that the gesture I already know still means what it meant.
2. As an Account, I want the bulk bar to offer "Tick all 4,213 that match" once every row on the page is ticked, so that I can take in the whole view with one more click.
3. As an Account, I want that offer only when the view matches more than one page, so that it does not appear when the page already is the whole view.
4. As an Account, I want the offer to name the view's total, so that I know what I am about to take in.
5. As an Account, I want a view of 10,000 or fewer to become Ticks, so that every bulk action I already use works on all of them.
6. As an Account, I want the bar to read "All 4,213 matching are ticked" afterwards, so that I can see it worked.
7. As an Account, I want those Ticks to survive a filter change, so that I can tick one view's entries and add another's on top, as I can with page Ticks.
8. As an Account, I want those Ticks to survive a reload, as all Ticks do.
9. As an Account, I want Ticks taken in this way to be usable as Seeds for Shared parents and Shared children, so that I can compare the Directory with a view I built.
10. As an Account, I want Dismiss on up to 10,000 Ticks to keep its Undo, so that a mistake costs one click.
11. As an Account, I want a view of more than 10,000 to offer "Act on all 48,210 matching", so that I can still Tag or Dismiss a view that large.
12. As an Account, I want the bar to tell me, in All matching, that the entries are held as this view, not ticked, that Follow and Seeds are off, and that changing the view clears it, so that the size threshold never surprises me.
13. As an Account, I want every row checkbox to show as ticked in All matching, so that the table agrees with the bar.
14. As an Account, I want to Tag every entry in All matching, so that I can name a large group in one step.
15. As an Account, I want to Untag every entry in All matching, so that I can undo a large Tag the same way.
16. As an Account, I want to Dismiss every unfollowed entry in All matching, so that I can clear a whole class of channels out of Discover and the Directory.
17. As an Account, I want Dismiss in All matching to ask first and say there is no Undo for more than 10,000, so that I never lose 48,000 entries to a stray click.
18. As an Account, I want the Follow button in All matching to stay visible but disabled, with the tooltip "Follow acts on 10,000 or fewer", so that I understand why it is off rather than wondering where it went.
19. As an Account, I want the confirmation after a Tag, Untag, Dismiss or Boost in All matching to state the count the server actually acted on, so that I know the truth even if the view moved since I clicked.
20. As an Account, I want any change to the view (filter, search, Yours, reference kinds, sort) to end All matching, so that an action never reaches a view I am no longer looking at.
21. As an Account, I want unticking one row in All matching to leave the page ticked minus that row, as Gmail does, so that I can step back to a hand-picked selection.
22. As an Account, I want Clear to end All matching, so that leaving it is as easy as entering it.
23. As an Account, I want All matching to be gone after a reload, so that a tab I reopen next week cannot tag 200,000 entries by surprise.
24. As an Account, I want Follow and Dismiss to keep acting on unfollowed entries only and Tag, Untag and Boost on every entry, in both modes, so that the rules do not change with the size.
25. As the Operator holding `DATA_ADMIN`, I want Boost to work on All matching, so that I can raise the priority of a whole view at once.
26. As an Account, I want All matching to reach only entries this view shows me (my own Follows, my own Dismissals hidden, my own Tags), so that one Account's view never acts on another's rows.
27. As an Owner in a View-as session, I want All matching writes to be refused or allowed exactly as the same writes with handles are, so that a larger selection opens no new door.
28. As an Account, I want a view of exactly 10,000 to become Ticks and 10,001 to become All matching, so that the boundary is a single well-defined number.
29. As a mobile Account, I want the offer and the All matching notice to fit the bulk bar's one sideways-scrolled line, so that the phone layout holds.

## Implementation Decisions

- **One threshold, 10,000**, the same number as the ticked-Seeds cap. At most 10,000 the gesture is a snapshot, above it All matching. The client decides from the view's total, which the list already returns.
- **A new read returns the handles a view matches.** It takes the same view request the list takes (filter, Yours, reference kinds, search) and answers every matching handle, in the list's sort order, with no page limit. Above 10,000 it refuses with a 422 rather than truncating, because the client should never have asked. It resolves through the same scoped Directory query as the list, so tenancy and Dismissals apply unchanged. It is a POST, like the list, because the view request is a body.
- **The four writes take exactly one of `handles` or `view`.** These are Dismiss (Discover's dismissal route, which the Directory already uses), Tag and Untag (the Tag channel routes) and Boost. `view` is the Directory view request. Both or neither answers 422. A `view` resolves server-side at action time through the same scoped query, and the write is set-based, not a handle list round-tripped through Python. Each response carries the count acted on.
- **Followed entries are excluded server-side for Dismiss with a `view`,** matching the client rule that Follow and Dismiss act on unfollowed entries only.
- **Undoing a Dismissal stays handles-only.** All matching gives no Undo, so the delete side of the dismissal route gains no `view`.
- **No new route for the predicate writes.** Extending the existing four keeps one door per action, so the existing permission (`DATA_ADMIN` for Boost), tenancy and View-as rules cover the new path with no new inventory entries.
- **The writes run in the request,** behind a statement timeout. They move to a worker job only if staging measures one over about 20 seconds.
- **Client state.** Ticks stay the stored handle list. All matching is an in-memory flag carrying the exact view request it was entered with. Any change to that request clears it, and so do Clear, unticking a row and a reload. While it is on, the bulk actions send the stored view instead of handles, and the table renders every selectable row as ticked.
- **The bulk bar** gains the offer line, the snapshot notice and the All matching notice with the copy from the plan, the disabled Follow with its tooltip, and an All matching Dismiss confirm. It stays props-only, so its states are testable without a server.
- **Regenerate the client** after the schema change. The writes' request types move from handles-only to one-of, so check the two-client split guard still accepts each call where it lives.

## Testing Decisions

- A good test drives behaviour from the outside and asserts what the Account sees or what the database holds afterwards. It does not assert which helper ran or how a query was composed. Mutation-test each new guard, and record what went red in the module docstring under "Watched to fail", as the boost tests do.
- **Backend HTTP, one new module.** It covers:
  - the handles read returns exactly the handles the list pages through, refuses above 10,000, and hides another Account's Dismissals and Follows;
  - each of Dismiss, Tag, Untag and Boost with a `view` touches exactly the rows the list shows, reports that count, and answers 422 for both or neither;
  - Dismiss with a `view` skips followed entries;
  - Boost with a `view` is still refused without `DATA_ADMIN`.
  Prior art is the Directory boost route tests (two accounts, one holding the permission), the Tags-belong-to-the-Account route tests, and the Directory browse tests for building a view. The account-isolation guard will demand the new read be probed with two live accounts, and that is wanted.
- **The `DirectoryBulkBar` component** in its existing test file. It covers no offer while the page is partly ticked or the page is the whole view; the offer with the total; the snapshot notice; the All matching notice; Follow disabled with its tooltip in All matching; and the All matching Dismiss confirm's copy. Prior art is the existing bulk bar tests for the five-or-more Follow confirm. A new branch without a component test fails the frontend CRAP ratchet.
- **One Playwright test** in the Directory spec: tick the page, tick all that match, Tag them, then filter by that Tag and see the full total. Prior art is the existing "tag the Ticks, see the badge, and filter by the Tag" test. Run it with one worker.

## Out of Scope

- Follow on more than 10,000 entries, at any confirmation level.
- An exclusion list for rows unticked inside All matching.
- Undo for a Dismissal over 10,000.
- All matching as Seeds, or kept across a reload.
- Tick all on any tab other than the Directory (Discover, Channels, Posts).
- A worker job for the set-based writes, unless the staging measurement calls for one.

## Further Notes

- The view request a write resolves must be the one the Account saw. The client stores the request it entered All matching with and clears the mode on any change, so the two cannot drift, apart from data that moved underneath. The confirmation's server count covers that case.
- Staging timing of a view-based Tag and Dismiss on the largest realistic view is the one open measurement. Record it beside the Directory staging timings once it is known.
