# Posts tab improvements: brief for the spec

Input for `/to-spec`, then `/to-tickets`. Every decision below was settled in a
grilling session on 2026-10-12 against prototype variant A, which the user
approved. The prototype is the primary source:
branch `prototype/posts-tab-improvements` (variants `0` = main, `A` = this
work), with run steps in `.scratch/posts-tab-prototype/README.md`. Its code was
written under prototype rules; rewrite it properly, do not promote it.

Glossary terms added in `CONTEXT.md`, landed with the spec:
**Channel posts in window**, **Channel posts in filtered window**, **Reply**,
and the Post filter's Conditions in **Condition**.

## Shipping

- No variant or flag on main: each change replaces today's behaviour.
- One spec (for documentation and review), then tickets, then one small PR per
  piece, `BarHistogram` first because two pieces draw it.

## The pieces

1. **Compact grid fills the row.** A text-only compact card's text grows to the
   height the tallest card in its grid row sets, in whole lines, never fewer
   than three, then "More". "More" expands that card in place (the row grows).
   The text must not set the row height itself.

2. **Photo viewer pages the Posts feed.** Near the last loaded photo (within
   three) the viewer asks the feed for its next page and takes in each
   thumbnail as it arrives. Stepping past the last photo stays on it; it never
   wraps and never jumps (a refreshed thumbnail keeps the place; a photo is
   known by its Post's card). Posts feed only: the Channels grid and a
   Summary's photo strip are unchanged.

3. **One `BarHistogram`.** The Channels number editor's bars and drag, moved
   out unchanged, drawing three things: the Channels tab's number filters
   (must look and behave exactly as today), the Posts tab's number filters,
   and the Analysis window chart.

4. **Posts number filters with histograms.** The Filters menu lists Views,
   Estimated views, Channel posts in window and Channel posts in filtered
   window, each editor opening on the shared histogram (32 bars, logarithmic
   past two orders of magnitude, a drag sets the bound, hover names a bar).
   - Views, Estimated views and Channel posts in window: bars over the window
     and the selected Channels, **other filters aside** (as the Channels tab
     and the Type/Media/Language counts do).
   - Channel posts in filtered window: bars count Channels by their filtered
     count, which is the definition's point.
   - Both Channel posts bounds are whole numbers: a low end rounds up, a high
     end down ("<= 29.5" is "<= 29"); the server accepts and rounds a fraction
     too, so a stored one keeps working.
   - Channel posts in filtered window = what the **whole** Post filter keeps
     with every Channel posts Condition removed (same answer wherever the
     Condition sits in AND/OR/NOT), keyword included, **before** the
     per-Channel cap.
   - Both apply inside Selection rules the same way, over the rule's own
     filter and the window it is applied in.
   - The bins are computed server-side (posts are far too many to ship).

5. **Analysis window histogram.** In the Analysis window editor, desktop
   popover and mobile sheet alike. 60 buckets spanning three times the window
   with the window centred and never past now; zoom out/in by x3. The window's
   buckets are solid; a drag sets a Fixed window. A **"Filtered | All posts"**
   toggle: Filtered = the Post filter, keyword and Channel spotlight, without
   the per-Channel cap; All posts = every Post of the selected Channels.

6. **Reply Types.** Two new Type values in the Type dropdown and the filter
   text form, with their counts:
   - **Is a reply**: the Post answers any Post, in any Channel, stored or not.
   - **Has a reply**: a Post **of its own Channel** answers it. A forward has
     one when the forwarding Channel answers it there. An answer from another
     Channel leaves its parent without one. (Matching on the parent's Channel
     as well as its id is required: a reply stores its parent's post id even
     across Channels, and the prototype's id-only match was wrong for those.)

## Facts measured against a deployment (no host named here)

- Last 30 days: 15,927 replies; 15,843 same-Channel, 83 cross-Channel, 1 to a
  private parent. Of 15,434 same-Channel replies with a stored parent, 285
  answer a forward.
- Over one week (~38k Posts): window histogram 0.8 s; Is-a-reply feed 0.9 s;
  Has-a-reply feed 0.3 s; Channel-posts feed 0.35 s; value histograms
  0.6-1.3 s.
- The Type/Media/Language counts take ~4.7 s a week **already**; the reply
  Types must not add to it. A correlated EXISTS for Has a reply cost ~9 s
  more and an unbounded reply set ~15 s; bounding the replies to those made
  since the window opened (a reply comes after its parent) costs nothing.

## Guards the PRs will meet

New routes must pass the account-isolation probe, the route inventory, the
approval gate and route-module hygiene; the generated client must be
regenerated; the CRAP ratchet wants component tests for new branching React
components; `types.conform.ts` already caught the new Type values once.
