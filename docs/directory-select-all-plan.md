# Directory: tick all that match

Decisions from the 2026-10-18 grilling. The rationale is in
`docs/migration/ADR-031-tick-all-matching.md`, and the term **All matching** is
defined in `CONTEXT.md`.

## Behaviour

1. The header checkbox ticks the page, as it does today.
2. When every selectable row on the page is ticked and `total > page size`, the
   bulk bar shows "100 on this page ticked. Tick all 4,213 that match", or
   "Act on all 48,210 matching" over 10,000.
3. **10,000 or fewer.** Clicking fetches every matching handle and replaces
   the Ticks with them. The bar then reads "All 4,213 matching are ticked." From
   there they are ordinary Ticks: they persist, they can be Seeds, and Dismiss
   keeps Undo.
4. **More than 10,000.** Clicking enters All matching, held in memory only. The
   bar reads: "**All 48,210 matching.** Over 10,000, so they are held as this
   view, not ticked: Follow and Seeds are off, and changing the view clears
   it. · Clear"
   - Follow stays visible but disabled, with the tooltip "Follow acts on 10,000
     or fewer."
   - Dismiss, Tag, Untag and Boost send the view. The toast reports the
     server's count.
   - Dismiss confirms first: "Dismiss 48,210 channels? This hides them in
     Discover and the Directory. There is no Undo for more than 10,000."
   - Any view change (filter, search, Yours, kinds, sort) ends it.
   - Unticking one row ends it and leaves the page's Ticks minus that row.
   - Every row checkbox renders as ticked while it is on.
5. Follow and Dismiss still act on unfollowed entries only. Tag, Untag and
   Boost act on every entry.

## Backend

- New read: a view's matching handles (`DirectoryViewRequest` in, handles
  out), refused above 10,000. It uses the list's scoped query with no page
  limit.
- `dismiss`, `tag`, `untag` and `boost` take exactly one of `handles` or
  `view`. Both or neither answers 422. A `view` resolves through the same
  scoped Directory query, so tenancy, Dismissals and View-as apply unchanged.
  The response carries the count acted on.
- Set-based writes (`INSERT … SELECT` / `UPDATE … FROM`) run synchronously
  behind a statement timeout. Measure on staging, and move to a worker job only
  if one runs over about 20 seconds.
- Regenerate the client.

## As built (2026-10-18)

- Tick all adds the view's handles to the Ticks. If that would pass 10,000,
  they replace the Ticks instead.
- The handles read takes the list's sort and answers in it.
- A Dismiss by view answers a count (`changed`) and no handles, since it can
  reach the whole Directory.
- Tick all is keyed on the URL's view, not the resolved request, so ticking
  all does not end itself when Yours or a Seed reads the Ticks.
- The view resolver lives in `app/api/directory_views.py`, so no route module
  imports another.
- The All matching Dismiss confirm says "Dismiss up to N channels? Followed
  ones are skipped.", because the server skips Follows.
- The four services take either a handle list or a SQL select of handles, so a
  view never round-trips handles through Python. Boost is one `UPDATE` for
  both shapes. The view-based writes run behind `SET LOCAL statement_timeout =
  '60s'`.
- The Playwright test asserts what the tab sends (handles after a snapshot, a
  `view` in All matching), since the Directory API is mocked there.

## Open after implementation

- Staging timing of a view-based Tag and Dismiss on the largest realistic view.
