# Channels skeleton: the loading placeholders follow the Card size

Status: done (merged in #271; closed 2026-11-03)

Ticket prefix: `CSK`.

Settled by a grilling session on 2026-11-02, with no prototype. The term **Card size** is
in `GLOSSARY.md` and is new for this work; the code calls it zoom. The plan with its rejected
options is `docs/channels-skeleton-card-size-plan.md`. The Posts tab's skeleton (RCH-01) is
the precedent: it already draws its placeholders in the shape of the cards that will load.

## Problem Statement

When the Channels tab loads, it shows eight placeholder cards drawn before Card size
existed: the shape of a Card, on the Cards column count, whatever Card size the Account
chose. An Account on Tiles sees eight large cards that turn into rows of small tiles once
the Channels arrive. An Account on Compact cards sees tall cards that shrink to a header
and a sync button. The page jumps, and the placeholders tell the Account nothing true
about what is coming.

## Solution

The placeholders take the shape, the columns and roughly the count of the cards that will
load, at the Card size the Account has stored. Tiles load as rows of small round tiles,
Compact cards as short header cards, Cards and Detailed cards as full cards whose sections
follow the Account's card settings. When the Channels arrive, each card lands where its
placeholder was.

## User Stories

1. As an Account on Tiles, I want the loading placeholders to be tiles, so that the page does not jump when my Channels load.
2. As an Account on Tiles, I want as many tile placeholders in a row as real tiles will fill, so that the grid looks the same before and after loading.
3. As an Account on Tiles, I want about a screen of placeholders, so that the page is not mostly empty while it loads.
4. As an Account on Compact cards, I want placeholders with only a header, the last-sync lines and a sync button, so that they are as short as the cards that replace them.
5. As an Account on Compact cards, I want no stat, tag or status placeholders, so that the skeleton does not promise fields the Compact card never shows.
6. As an Account on Compact cards, I want the same column count as the loaded grid, so that cards do not reflow on arrival.
7. As an Account on Cards, I want placeholders with a header, bio, stat tiles, tags and a footer, so that the skeleton reads as the card I know.
8. As an Account on Cards who hides the bio, I want no bio lines in the placeholder, so that the placeholder is not taller than the card.
9. As an Account on Cards who shows extra counters, I want as many stat-tile placeholders as my cards will show, so that the stat row has the right length.
10. As an Account on Detailed cards, I want placeholders with the about line, the Start ID and a second schedule line, so that they match the taller Detailed card.
11. As an Account on Detailed cards, I want every optional section in the placeholder whatever my card settings, because Detailed cards show every field.
12. As an Account on Detailed cards, I want no more columns than the loaded grid uses, so that wide screens do not show narrower placeholders than the cards.
13. As an Account on a narrow window, I want the placeholders to use the columns the grid would use at that width, so that phones and split screens look right too.
14. As an Account with a sidebar open, I want the column count taken from the grid's own width, not the window's, so that the placeholders match the space the grid really has.
15. As an Account who changes Card size and reloads, I want the next load's placeholders in the new size, so that the skeleton always follows the stored choice.
16. As an Account in Keyboard mode, I want the skeleton to carry no controls, so that nothing on it takes a key before the Channels load.
17. As an Account, I want placeholders without a checkbox, badges or hover bar, so that the skeleton stays calm, as the Posts skeleton does.
18. As an Account using a screen reader, I want the loading state to read as it does today, so that nothing new is announced.
19. As an Account with no Channels, I want the empty state unchanged, so that a new Account is still told to add a Channel.
20. As an Account whose search matches nothing, I want the "no channels match" state unchanged.
21. As an Account taking the product tour, I want the tour's Channel grid anchor on the skeleton as it is today, so that the tour still points at the grid while it loads.
22. As a developer, I want the skeleton's column count to come from the same function as the grid's, so that the two cannot drift apart.
23. As a developer, I want the grid's width measurement shared by the grid and the skeleton, so that it is written once.
24. As a developer, I want the Cards and Detailed cards placeholders to read their sections from the card face, so that a new card field reaches the skeleton with no second edit.
25. As a developer, I want the skeleton's shape per Card size checked by a test, so that a regression back to one shape goes red.

## Implementation Decisions

- **One skeleton per Card size.** Tiles: a 48px circle alone (the real tile shows only the photo), at the
  tile's width. Compact cards: the header (photo, name, handle), the last-sync lines and a sync button. Cards: the
  header, bio lines, a stat-tile row, tags, and a footer with status. Detailed cards: the
  Cards shape plus the about line, the Start ID and a second schedule line. A single shape scaled by
  height was rejected because it stays wrong at Tiles.
- **Columns come from the grid's lane function.** It is `gridLanesForWidth(width, zoom)`, with
  the width measured the way the virtualised grid measures its own. That measurement moves
  out of the virtualised grid into one small piece both use. CSS `auto-fill` per size was
  rejected: it disagrees with the real grid for Detailed cards, whose columns are capped at
  the Cards count.
- **Count fills about one screen.** Lanes times a row count per Card size, 6 rows of Tiles,
  4 of Compact cards, 2 of Cards or Detailed cards. A fixed eight was rejected.
- **Cards and Detailed cards take their shape from the card face.** That is `cardFace(zoom,
  settings)`. Bio lines only when the face shows a bio, one stat placeholder per stat tile
  the face lists, the Start ID when the face shows it, the about line only when detailed. Tiles and Compact cards need no
  settings.
- **No card chrome on placeholders.** No checkbox, badges, hover bar or controls, matching
  the Posts skeleton.
- **The skeleton becomes its own component** beside the grid body, which renders it while
  loading. It takes the Card size and the card settings. The loading, empty and grid
  branches of the body, and the tour anchor id, stay as they are.
- Each placeholder carries its Card size as a data attribute, which the test reads.

## Testing Decisions

- A good test renders the grid body while loading and checks what an Account would see:
  which shape appears, how many placeholders, how many columns. It does not reach into the
  skeleton's internals or its class names beyond the data attribute.
- **One seam, the grid body.** Tested through its existing render test (the static-markup tests
  beside the grid's parts). Render it loading at each of the four Card sizes and check:
  every placeholder carries that Card size; Tiles and Compact cards have no stat
  placeholders; Cards with the bio setting off have no bio lines; Detailed cards have the
  about block; the count is lanes times the size's rows at the render width.
- The lane function already has its own unit tests; they stay as they are.
- Mutation-check the test by forcing one shape for every Card size and by dropping the
  `cardFace` read, and record the `Mutation-checked:` line in the commit body.
- Prior art: the Posts skeleton's shape per card size (RCH-01), and the existing loading test
  in the grid parts tests ("shows skeletons while loading, whatever the counts say").

## Out of Scope

- Placeholders when the Card size changes after load: the cards are already on screen.
- The infinite-scroll page load at the bottom of the grid, which shows no skeleton today.
- Skeletons on any other tab.
- A Playwright check of the skeleton; the render test is the one seam.

## Further Notes

- The user asked to see the finished result before the PR merges: a screenshot of the
  skeleton at each Card size, taken from a dev server with the channels request held.
