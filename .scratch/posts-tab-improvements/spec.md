# Posts tab: fuller compact cards, a paging photo viewer, histograms, Channel posts bounds and reply Types

Status: ready-for-agent

Ticket prefix: `PTI`.

Settled in a grilling session on 2026-10-12, after a prototype whose variant `A` the user
approved. The prototype is on the pushed branch `prototype/posts-tab-improvements` (variant `0` is
main, `A` is this work; run steps in `.scratch/posts-tab-prototype/README.md` on that branch). Its
code was written under prototype rules: rewrite it, do not promote it. The decision record the
session produced is `brief.md` beside this file. No ADR: every decision reverses at the cost of a
ticket. The new terms (Channel posts in window, Channel posts in filtered window, Reply) and the
Post filter's widened Conditions are in `CONTEXT.md` under Choosing Posts.

## Problem Statement

On the Posts tab the compact grid wastes space. Every compact card shows three lines of text
whatever its neighbours do, so a row that holds one card with a photo leaves the text-only cards
beside it with a tall blank area under three lines, and a long Post has to be expanded to be read
even though the room is already there.

The photo viewer browses only the photos already loaded. The feed loads 20 Posts at a time and
more as the Account scrolls, but the viewer took a snapshot when it opened, so browsing photos
stops at the end of the first page and the Account has to close the viewer, scroll, and reopen it.

The Analysis window is edited as numbers (Start, End, Duration, End gap) with nothing to show where
the Posts are. Choosing a window around a burst of activity, or noticing that a window catches
nothing, means guessing and reading the count afterwards.

The Posts tab's number filters (Views, Estimated views) open on bare fields. The Channels tab's
number filters open on a histogram that shows the distribution and sets the bound by a drag; the
Posts tab has no such thing, so an Account picks a views bound blind.

An Account cannot filter out noisy Channels. A Channel posting two hundred times a day buries the
quiet ones, and there is no Condition on how busy a Post's Channel is, overall or in the kind of
Post the Account is looking for.

An Account cannot find replies. Telegram Channels answer their own Posts (corrections, follow-ups,
threads), and the Type filter knows only Original, Forwarded and Forwarded from unfollowed
channels, so a Post that starts a thread looks like any other.

## Solution

Compact cards use the height their grid row already has. A text-only card's text grows to the
height the tallest card in its row sets (usually one with a photo), in whole lines, never fewer
than three, and a "More" link appears only when the text still does not fit. "More" expands that
card in place; "Less" puts it back.

The photo viewer pages the feed. As the Account nears the last loaded photo, the feed loads its
next page and the viewer takes in the new photos as they arrive, so browsing continues through the
whole feed. Past the last photo it stays on the last photo: it never wraps to the first and never
jumps.

The Analysis window editor shows a histogram of the Posts over time: the window and the same span
again on each side, the window's bars solid. Dragging across the bars sets a Fixed window. Zoom out
and in widens and narrows the span. A toggle switches the bars between the Posts the Post filter
keeps (Filtered) and every Post of the selected Channels (All posts).

The Posts tab's Filters menu offers four number filters, each opening on the same histogram the
Channels tab uses: Views, Estimated views, Channel posts in window and Channel posts in filtered
window. One bar component now draws the Channels tab's filters, the Posts tab's filters and the
Analysis window chart, so all three look and drag alike.

Two new Conditions bound how busy a Post's Channel is. Channel posts in window counts every Post
the Channel has in the Analysis window. Channel posts in filtered window counts only the ones the
rest of the Post filter keeps. Both are whole numbers.

Two new Types: Is a reply and Has a reply. Has a reply means a Post of the Post's own Channel
answers it, including a Channel answering a Post it forwarded.

## User Stories

### Compact grid

1. As an Account browsing the compact grid, I want a text-only card's text to fill the height its row already has, so that I read more of each Post without expanding it.
2. As an Account, I want the extra text to come in whole lines, so that no line is cut in half at the bottom of a card.
3. As an Account, I want a text-only card to show at least three lines even when no card in its row is taller, so that a row of short cards still shows something of each Post.
4. As an Account, I want "More" to appear only when the text does not fit, so that a short Post shows no needless link.
5. As an Account, I want "More" to expand the card in place, so that I keep my position in the grid.
6. As an Account, I want "Less" on an expanded card, so that I can put the row back.
7. As an Account, I want a card's text never to make its row taller unless I expand it, so that one long Post does not stretch a whole row.
8. As an Account who resizes the window, I want the line count to follow the row's new height, so that the fit stays right after a reflow.
9. As an Account whose keyword search highlights words, I want highlighting and Links to work in the taller text exactly as in the three-line text, so that nothing is lost by showing more.
10. As an Account reading a right-to-left Post, I want the filled text to keep its direction, so that Persian and Arabic Posts read correctly.
11. As an Account, I want the card footers in a row to stay aligned at the bottom, so that the grid still reads as rows.

### Photo viewer

12. As an Account browsing photos from the Posts feed, I want the viewer to keep going past the first page of Posts, so that I can browse every photo in the feed without closing it.
13. As an Account, I want the next page to start loading before I reach the last loaded photo, so that stepping forward rarely waits.
14. As an Account at the last loaded photo while more are loading, I want the caption to say more are loading, so that I know to wait rather than think I reached the end.
15. As an Account, I want the right arrow and the next button to do nothing at the very last photo, so that I am never thrown back to the first photo.
16. As an Account, I want my place kept when a thumbnail elsewhere in the feed reloads, so that the viewer never jumps while I browse.
17. As an Account, I want the "n / total" count to grow as photos arrive, so that I can tell how far I am.
18. As an Account who closes the viewer, I want the feed left at the Post of the last photo I viewed, as today, so that paging does not lose my place.
19. As an Account browsing photos on the Channels grid or in a Summary's photo strip, I want those viewers unchanged, so that a gallery that is already complete keeps behaving as it does.

### Analysis window histogram

20. As an Account editing the Analysis window, I want to see how many Posts fall in each part of the time around it, so that I can choose a window where the Posts are.
21. As an Account, I want the window's own bars drawn solid and the context around it light, so that I see what the current window covers.
22. As an Account, I want to drag across bars to set the window, so that I can pick a burst of activity directly.
23. As an Account, I want a click on one bar to set the window to that bar's span, so that I can zoom into one period quickly.
24. As an Account, I want a drag to make a Fixed window, so that the window I chose from the chart stays where I put it.
25. As an Account, I want to zoom out to see three times as much time, and back in, so that I can find activity outside the current window.
26. As an Account, I want the chart never to extend past now, so that it shows no empty future.
27. As an Account, I want hovering a bar to show its start and its Post count, so that I can read the chart precisely.
28. As an Account, I want the chart to count the Posts my Post filter, keyword and Channel spotlight keep (Filtered), so that it shows the Posts I am actually looking at.
29. As an Account, I want to switch the chart to All posts, so that I can see raw activity of my selected Channels regardless of my filter.
30. As an Account, I want the per-Channel cap left out of the chart, so that the bars do not depend on the feed's sort order.
31. As an Account on a phone, I want the same chart in the bottom sheet, so that the window can be chosen the same way everywhere.
32. As an Account whose window is Live, I want the chart to follow the window as it advances, so that it never describes a stale window.

### Number filters with histograms

33. As an Account opening Views or Estimated views in the Filters menu, I want a histogram of the Posts in the window, so that I can see the distribution before choosing a bound.
34. As an Account, I want the histogram on a logarithmic scale when the values span orders of magnitude, so that the Posts do not all pile into the first bar.
35. As an Account, I want dragging across bars to fill the bound's fields, so that I can set a bound from the shape of the data.
36. As an Account, I want a drag that touches the first bar to leave the low end open and one that touches the last bar to leave the high end open, so that "at most" and "at least" come from a drag naturally.
37. As an Account, I want the bars inside the bound I typed drawn solid, so that the fields and the chart agree.
38. As an Account, I want the caption to show the median, and a hovered bar's count and range, so that I can read the chart.
39. As an Account, I want the Posts tab's histogram to look and drag exactly like the Channels tab's, so that I learn it once.
40. As an Account using the Channels tab's number filters, I want them unchanged, so that nothing I rely on there moves.
41. As an Account, I want the Views, Estimated views and Channel posts in window histograms to ignore my other filters, so that the bars do not shift every time I change another Condition.
42. As an Account opening Channel posts in filtered window, I want its histogram to count Channels by their filtered count, so that it shows the very number the bound tests.
43. As an Account whose window holds nothing with a value, I want the editor to say so instead of an empty chart, so that I understand why there are no bars.

### Channel posts in window

44. As an Account, I want a Condition on how many Posts a Post's Channel has in the Analysis window, so that I can hide the Posts of Channels that post too much.
45. As an Account, I want "at most 5" to keep only Posts from Channels with five or fewer Posts in the window, so that quiet Channels surface.
46. As an Account, I want "at least 50" to keep the Posts of busy Channels, so that I can look at them on purpose.
47. As an Account, I want the count taken over the whole window before any filter, so that a Channel's busyness does not change with my other Conditions.
48. As an Account, I want the count to follow the Analysis window, so that a Channel quiet this week and busy last month is judged for the window I chose.
49. As an Account, I want the bound to be whole numbers even when a drag lands between two counts, so that "≤ 29.5" never fails and means "≤ 29".
50. As an Account with a fractional bound already saved, I want it to keep working, so that an old filter does not break every read.
51. As an Account, I want a bound with no whole number between its ends refused, so that I cannot add a Condition that keeps nothing by accident.
52. As an Account, I want the Condition in a Selection rule to count within the window the rule is applied in, so that the rule means the same thing in every window.
53. As an Account, I want the Condition to read "Channel posts in window ≤ 5" as a chip and `channel_posts <= 5` in the filter's text form, so that I can read it and share it.

### Channel posts in filtered window

54. As an Account, I want a Condition on how many of the Channel's Posts in the window my Post filter keeps, so that I can hide Channels busy in the kind of Post I am looking for.
55. As an Account filtering on "Type: Original", I want a Channel with 200 Posts of which 20 are original to count 20, so that the bound speaks about what I filter for.
56. As an Account, I want the count to take my whole Post filter with every Channel posts Condition set aside, so that the answer is the same wherever the Condition sits in AND, OR and NOT and never counts itself.
57. As an Account, I want the keyword search included in the count, so that "filtered" means everything my filter does.
58. As an Account with a per-Channel cap, I want the count taken before the cap, so that a bound above the cap still means something.
59. As an Account, I want its bound whole, like Channel posts in window, so that both behave alike.
60. As an Account, I want it next to Channel posts in window in the Filters menu, so that I can choose between the two.

### Reply Types

61. As an Account, I want "Is a reply" in the Type dropdown, so that I can find Posts that answer another Post.
62. As an Account, I want "Is a reply" to include replies to Posts of other Channels and to Posts never stored, so that the Type is about the Post itself.
63. As an Account, I want "Has a reply" in the Type dropdown, so that I can find Posts that started a thread.
64. As an Account, I want "Has a reply" to count only answers from the Post's own Channel, so that nothing I see depends on Channels other Accounts follow.
65. As an Account, I want a forward to have a reply when the forwarding Channel answers it there, so that threads under forwarded Posts are found too.
66. As an Account, I want an answer from another Channel never to mark a Post of the answering Channel by mistake, so that "Has a reply" is right.
67. As an Account, I want both Types counted in the Type dropdown like the others, so that I see how many Posts each would keep.
68. As an Account, I want the two Types to combine with the others by OR inside the dropdown and by AND across dropdowns, as every Type does, so that they need nothing new to learn.
69. As an Account, I want them in the filter's text form (`type:is_reply`, `type:has_reply`), so that a shared link keeps them.
70. As an Account, I want the Type dropdown's counts to be no slower than today, so that adding two Types costs me nothing.

### Across the work

71. As an Account viewing another account through View-as, I want every new chart and filter to answer for that account, so that what I inspect is theirs.
72. As an Account, I want every new read scoped to my Follows, so that no chart counts another account's Channels.
73. As an Operator, I want no switch to turn this off, so that there is no dead code path to maintain.

## Implementation Decisions

### The Post filter's vocabulary

- **Two new Type values**, `is_reply` and `has_reply`, appended to the Type list after the
  existing three, labelled "Is a reply" and "Has a reply". The server's Type vocabulary and the
  browser's stay one set (the conformance check already fails the build when they drift).
- **Two new Conditions**, both a bound with optional `min` and `max` and no "no value" form (every
  Channel with a Post in the window has a count):
  - `channel_posts`: Channel posts in window. Text form `channel_posts <= 5`,
    `channel_posts >= 50`, `channel_posts 10..30`. Chip "Channel posts in window ≤ 5".
  - `channel_posts_filtered`: Channel posts in filtered window. Text form
    `channel_posts_filtered <= 5`. Chip "Channel posts in filtered window ≤ 5".
  - The prototype's text word `chposts` and label "unfiltered range" are not kept.
- **Whole bounds.** The browser rounds a bound inward before sending it (low end up, high end
  down); a bound with no whole number left between its ends cannot be added. The server accepts a
  fraction and rounds it the same way, so a stored fractional bound keeps working. The rule, from
  the prototype:

  ```ts
  // low end rounds up, high end down: "<= 29.5" keeps exactly what "<= 29" keeps
  const min = bound.min === undefined ? undefined : Math.ceil(bound.min)
  const max = bound.max === undefined ? undefined : Math.floor(bound.max)
  if (min !== undefined && max !== undefined && min > max) return null
  ```

### Evaluating the new Conditions

- Both Channel posts Conditions are evaluated against the **Analysis window the read resolves**:
  the feed's, the counts', the Type/Media/Language counts' and, inside a Selection rule, the window
  the rule is applied in. The Post filter's predicate builder therefore receives the window.
- **Channel posts in window** keeps a Post when its Channel's count of Posts in the window, with no
  filter, lies in the bound: one grouped count per Channel, computed once per read and joined as a
  set of Channels, never a per-row count.
- **Channel posts in filtered window** does the same over the Posts that the Post filter with every
  Channel posts Condition removed (the existing tree-pruning helper) and the keyword keep, before
  the per-Channel cap. Inside a Selection rule it uses the rule's own tree and keyword.
- **Is a reply**: the Post names a parent post id.
- **Has a reply**: some stored Post names this Post as its parent **and** names this Post's
  Channel as the parent's Channel (compared case-insensitively). Matching on the parent id alone is
  wrong: a reply stores its parent's id even across Channels, so an id-only match marks a Post of
  the answering Channel. It is a semi-join against the replies made **since the window opened**
  (a reply comes after its parent), computed once per read; a correlated per-row `EXISTS` and an
  unbounded reply set were both measured far too slow for the Type counts. Replies of the Post's
  own Channel are by definition in a Channel the Account follows, so the read stays inside the
  Follows without a check of its own.
- The Type counts gain the two Types as two more filtered aggregates in the existing single scan,
  and must not measurably slow it.

### New reads

Both are POST reads that carry the scope in the body, for the reason the counts read already is a
POST, and both read through the tenancy seam exactly as the feed does.

- **Window histogram**: the filtered-request body plus `extentStart`, `extentEnd`, `buckets`
  (1 to 500, the chart asks for 60) and an `unfiltered` switch. Answers `{ counts: number[] }`, one
  count per equal slice of the extent. Filtered applies the Post filter, keyword and Channel
  spotlight without the per-Channel cap; unfiltered applies only the selected Channels. A Channel
  posts Condition inside it still counts within the Analysis window, not the extent.
- **Value histogram**: the filtered-request body plus `measure`, one of `views`, `estimated`,
  `channel_posts`, `channel_posts_filtered`. Answers the bars and their edges:

  ```
  { bins: int[32], edges: float[33], log: bool, median: float | null,
    measured: int,   // Posts (or Channels) with a value
    total: int }     // all of them
  ```

  32 bars from the lowest value to the highest, logarithmic (log, or log(1 + x) from zero) when
  the highest is more than 100 times the lowest: the Channels tab's rule, so one component draws
  both. `views`, `estimated` and `channel_posts` ignore the Post filter and keyword;
  `channel_posts_filtered` applies them as its definition says. The first two count Posts, the
  other two Channels.
- Their docstrings ship in the public client: ticket ids go in a comment above the decorator, not
  in the docstring. Regenerate the client.

### One bar component

- The Channels number editor's bars, drag, hover and caption move into a shared presentational
  component, unchanged. Its interface, from the prototype:

  ```ts
  BarHistogram({
    bins: number[]
    solid: (i: number) => boolean        // inside the selection while nobody drags
    onSelect: (run: { from: number; to: number }) => void
    caption: (shown: number | null) => [left, middle, right]
  })
  ```

- On top of it, a bound histogram takes a distribution (`bins`, `edge(i)`, `lo`, `hi`, `median`,
  `log`), draws the bars a bound keeps solid, turns a run into a bound (touching the first bar
  leaves the low end open, the last the high end) and captions "n posts, a–b" or the median. The
  Channels editor builds its distribution in the browser as today; the Posts editors take theirs
  from the value histogram read.
- The Analysis window chart uses the bars directly with its own solid rule (the window's buckets)
  and caption (dates, the hovered bucket's count).

### The Filters menu and its editors

- The menu lists Views, Estimated views, Channel posts in window, Channel posts in filtered window,
  in that order, each showing the bounds already in the filter beside it; the pill counts all four
  kinds. The filter row's condition picker offers the same four under its Numbers heading.
- Each editor shows the histogram, the operator and fields, and Add/Update. A drag fills the
  fields; typing redraws the solid bars.

### The Analysis window chart

- Part of the window editor itself, so the desktop popover and the mobile sheet both carry it.
- Extent: `span = max(end - start, 1 minute)`; the chart spans `span × 3 × 3^zoom`, centred on the
  window and never past now. 60 buckets. Zoom out multiplies by three; zoom in stops at the
  default.
- A drag over buckets sets a Fixed window from the first bucket's start to the last bucket's end.
- The Filtered/All posts toggle and the zoom start at Filtered and the default zoom each time the
  editor opens; neither is stored.

### The photo viewer

- The gallery and the position are one piece of state, so they can never disagree.
- A photo is known by its Post's card, falling back to its address: a card outlives its
  thumbnail's object address, which changes when the feed refreshes.
- While open from the Posts feed, the viewer watches the page for new photos and takes in each as
  it lands; a rescan that no longer finds the current photo is ignored, never answered by moving
  to the first photo. Within three photos of the end it asks the feed for its next page. Steps
  clamp at both ends.
- Only the Posts feed provides paging; any other gallery behaves exactly as today.

### The compact card

- The text sits in a layer positioned inside a box that grows to fill the card, so it adds nothing
  to the row's height; the box is at least three lines tall. The number of lines shown is the
  box's height divided by the line height, rounded down, never under three, re-measured whenever
  the box resizes. "More" shows only when the text is taller than those lines; expanded, the text
  is laid out normally and the card grows; "Less" returns it.
- The full card (not compact) is unchanged.

### Shipping

- No variant, flag or switcher on main: each piece replaces today's behaviour. The prototype's
  variant context, switcher, search parameter, proxy split and standalone launcher do not ship.
- One PR per piece, the shared bar component first, since the Posts editors and the window chart
  draw it.

## Testing Decisions

- A good test drives a seam a caller uses and asserts what that caller sees: a response body, a
  rendered label, the filter text a click produces. It never asserts SQL text, a private helper or
  a component's internal state. Every new test is watched failing once against a mutation of the
  code it guards before it is trusted (the repo's rule).
- **Backend: the posts HTTP API, one seam for every server change**, against the test database.
  Cases: Is a reply (same Channel, cross Channel, private parent); Has a reply (same Channel, a
  forward answered by the forwarding Channel, an answer from another Channel marking nothing, a
  coincidental id in the answering Channel marked by nothing); Channel posts in window (both ends,
  between, a fraction rounded inward, an empty whole range refused by the browser and rounded by
  the server, a different window changing the answer, inside a Selection rule); Channel posts in
  filtered window (the Original example, set aside under OR and NOT, keyword counted, cap ignored);
  the Type counts including both new Types; the window histogram (filtered against unfiltered,
  cap ignored, extent edges, spotlight); the value histogram (linear against logarithmic, the
  filtered measure applying the filter, an empty window). Prior art:
  `tests/api/test_post_filter_tree.py`, `tests/api/test_post_views_feed.py`,
  `tests/api/test_post_selection.py`.
- The existing guards see the new routes without new code of their own: account isolation (probe
  both reads with two live accounts), route inventory, the approval gate, route-module hygiene,
  and the View-as read-only check (both are reads).
- **Frontend: the existing component seams, no new ones.**
  - The Posts filter bar's props-only test: the Filters menu's four entries in order, each
    editor's histogram drag producing the filter text, whole rounding, the Type dropdown's two new
    rows. The histogram's read arrives through context, so a test supplies a fake one.
  - The Channels number editor's existing tests, **unchanged**: they are the proof that the shared
    bar component changed nothing there.
  - The Analysis window control's test: the chart renders, a drag sets a Fixed window, the toggle
    switches what is requested, zoom widens the extent.
  - The photo viewer's DOM test: paging asks for more near the end, a key or button press at the
    end stays on the last photo, a refreshed thumbnail keeps the place, a lost photo moves
    nothing.
- **One new check: a Playwright spec with a mocked API** for the compact grid, because whole lines
  filling a row height need a real layout engine and the unit tests' DOM has none: a row with one
  photo card and one long text-only card shows more than three lines and a "More"; a short one
  shows no "More"; "More" grows the card. Prior art: `frontend/tests/summarizer-posts-*.spec.ts`.
- The frontend CRAP ratchet fails a new branching component with no unit test: the bar component
  and the editors get theirs through the seams above.

## Out of Scope

- Paging in the Channels grid's or a Summary's photo viewer.
- The Type/Media/Language counts' existing cost (~4.7 s for a week of every Follow); this work
  only must not add to it.
- Histograms for Type, Media or Language, which are lists, not numbers.
- A per-Channel breakdown chart of the window (considered and dropped: the Channel posts in window
  histogram already shows that distribution).
- Counting answers from other Channels, or Telegram discussion-group comments, as replies.
- Storing the chart's toggle or zoom.
- Any change to the full (non-compact) card, the Directory filter or the Channels tab beyond the
  shared bar component.

## Further Notes

- Measured on a deployment for one week of every Follow (~38k Posts): window histogram 0.8 s;
  Is-a-reply feed 0.9 s; Has-a-reply feed 0.3 s; a Channel posts feed 0.35 s; value histograms
  0.6 to 1.3 s; Type counts 4.7 s before and after adding the reply Types.
- Over 30 days the deployment had 15,927 replies: 15,843 within their own Channel, 83 across
  Channels and 1 to a private parent. Of 15,434 same-Channel replies with a stored parent, 285
  answer a forward.
- Three defects the prototype found and fixed, each worth a test: an id-only reply match marked
  the wrong Post; a dragged edge such as 29.5 failed an integer-only bound; the viewer reset to the
  first photo when a rescan could not find the current one.
- The glossary changes in `CONTEXT.md` landed with this spec.
