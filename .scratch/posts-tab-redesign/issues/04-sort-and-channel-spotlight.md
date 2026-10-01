# PTR-04: Channels-style Sort and Channel spotlight

**What to build:** Sorting on the Posts tab works the way it does on the Channels tab: one
searchable Sort menu (Post date, Views, Estimated views) and a direction arrow, and the views
orders read their own measure instead of borrowing the filter's. And from any card an Account can
open a **Channel spotlight**: that Channel's Posts alone, everything in the window by default or
narrowed by their filters if they ask, with the way back to the card they came from. A spotlight
never changes the Scope. See `.scratch/posts-tab-redesign/spec.md`, "Channel spotlight" and the
sorting decision under "The Post filter", and user stories 20 to 24, 29 (f) and 47 to 48.

**Blocked by:** PTR-02, PTR-03

**Status:** done

### Sort

- [x] A Sort pill with a search over Post date, Views and Estimated views, and a direction arrow
      beside it, as on the Channels tab, replacing the Order pill
- [x] The views orders carry their own measure in the feed request and in the Scope's order, so
      choosing Views to sort never changes what a views bound in the filter means. A Scope frozen
      before keeps its old meaning. As built, no wire change: since PTR-03 a bound names its own
      measure in the tree, so the existing `viewMeasure` field is already read by the views
      orders alone. The Sort menu maps Post date, Views and Estimated views plus the arrow onto
      `sort` and `viewMeasure`; the palette's four order commands stay as they were
- [x] The per-Channel cap's "ordered" mode follows the chosen order and direction, as today

### Channel spotlight

- [x] The card's Channel name, a followed forward source, a "Show this Channel" footer action and
      the f key open a spotlight on that Channel
- [x] A spotlight replaces the Post filter with a single Channel Condition and drops the cap and
      the grouping while it is on; "Keep my filters" joins the Channel Condition with AND to the filter
      the Account had instead. As built, the spotlight holds its own tree and never writes the
      Account's (or the URL's `?postFilter=`): the filter row shows and edits the spotlight's tree,
      the feed's request names only that Channel, and the keyword applies only with filters kept.
      Leaving drops the spotlight, so the old filter returns by construction
- [x] A sticky banner names the Channel (avatar, title linking to Telegram), says whether it shows
      everything or keeps the filters, and has "Back to feed" with an Esc hint
- [x] "Back to feed" and Escape restore the filter the Account had and scroll the feed back to the
      card the spotlight started from (or the scroll position, if that card is gone). Escape while
      the photo viewer is open closes the viewer only
- [x] A meaning search or "find related" leaves the spotlight first; a spotlight is never part of
      a Scope, and an Action submitted during one covers what it would have without it

### Tests

- [x] Route tests for the sort's own measure: Views and Estimated views orders each read theirs
      with a views bound on the other measure present
- [x] Component tests for the Sort menu and the spotlight banner (keep filters, back, Escape with
      and without the viewer open). Also the card's three ways in, the scroll back, a search
      leaving the spotlight, and a Playwright spec (`summarizer-posts-spotlight.spec.ts`) for the
      request each carries
- [x] A pure test that entering and leaving a spotlight returns the exact filter that was there
