# Posts tab redesign

Status: ready-for-agent

Ticket prefix: `PTR`.

Settled by a UI prototype run over one session (2026-10-01) and a grilling session the same day.
The prototype lives on the branch `claude/mattpocock-skills-post-card-4f5186` (pushed, never to be
merged); its commit before this spec is `28c5152`, and `?variant=A-plus-select` on the Posts tab
shows the winner. The terms **Post filter**, **Post selection**, **Selection rule**, **Pick** and
**Channel spotlight** are in `CONTEXT.md`, whose **Scope** and **Condition** entries changed with
them. **ADR-026** records why the post filters leave the Scope; read it before changing anything
in this spec's model.

## Problem Statement

The Posts tab's card is a header strip, a body and a hover-only action bar. The actions are
invisible until the pointer finds them, the photo sits under the text at a size that cannot be
enlarged, and reactions the server already sends are never shown. There is no way to see "the
other posts from this channel" without leaving the feed, changing the Channel selection, and
changing it back.

The filters cannot say much. Each of Type, media kinds and Languages is one list of values that
OR together, the views filter is one threshold, and nothing can be negated: "not Persian", "photos
that are not forwards" or "(Persian videos) or (anything over 10K views)" are out of reach. The
Channels tab can say all of these about Channels, with a different set of controls.

And the filters do two jobs at once. Whatever the Account narrows the feed to in order to read
is also exactly what the next Summary, Chat, Tag run or Discovery report covers. Looking around
changes the Summary; the only way to read wider without changing it is to remember to undo it.
There is also no way to say "all of these except that one", or "drop the Arabic ones from what I
summarize" while still reading them.

## Solution

**The card** puts the photo above the text, like Telegram, at the size it has today, and a click
opens it full screen, whole, with zoom, pan and a gallery through every photo in the feed. Every
action sits in a visible footer, reactions are shown, and the Channel's name opens a **Channel
spotlight**: that Channel's Posts alone, with the way back to where the Account was. A Compact
grid packs short cards into columns for scanning, and a Keyboard mode moves through the feed and
fires the actions with single keys.

**The Post filter** is the Channels tab's filter, built from the same components: Type, Media and
Language dropdowns whose funnels add Conditions; a Filters menu for bounds on Views and Estimated
views; and a filter row where Conditions join with AND or OR, any block can be negated, and
blocks nest in parentheses. It decides only what the Posts tab shows. It lives in the URL, and
sorting works the way the Channels tab's does.

**The Post selection** decides what an operation covers. It starts as one Selection rule, select
all, so an Account that never touches it summarizes everything in the window, as before. Selecting
or deselecting everything the filter shows, or every Post with one value from a dropdown, records
a Selection rule that follows the Account into the next window. Ticking or unticking one Post
records a Pick that stays with that exact Post. The steps show as chips, last one wins, and each
Artifact freezes them along with a reference to every Post they reached.

## User Stories

### The card

1. As an Account, I want a Post's photo above its text, so that it reads the way Telegram shows it.
2. As an Account, I want the photo at the size the card uses today, never cropped or stretched, so that a tall or wide photo keeps its shape.
3. As an Account, I want to click a photo and see the whole of it as large as my screen allows, so that I can read what is in it.
4. As an Account, I want to zoom into a photo with the scroll wheel or a trackpad pinch, centred on my pointer, so that I can read a detail.
5. As an Account, I want a double-click to toggle a 2.5x zoom on the spot I clicked, so that a quick look at a detail is one gesture.
6. As an Account, I want to drag a zoomed photo around, and never past its own edges, so that I cannot lose it off screen.
7. As an Account, I want the left and right arrow keys, and two buttons, to step through every photo in the feed, so that I can look through the images without scrolling between cards.
8. As an Account, I want each photo I step to to start whole again, so that a zoom on one does not carry over to the next.
9. As an Account, I want a click on an unzoomed photo, Escape or the close button to close the viewer, so that leaving is never hard.
10. As an Account, I want the feed left at the Post of the last photo I looked at, so that closing the viewer puts me where my browsing ended.
11. As an Account, I want the viewer to name the Channel and say "3 of 41", so that I know where I am in the feed.
12. As an Account, I want every action visible in the card's footer (show this Channel, translate, find related, copy link, open in Telegram), so that I do not have to hover to find them.
13. As an Account, I want a Post's reactions shown, the most frequent first, so that I can see how it was received.
14. As an Account, I want the view count in the footer with the exact number on hover, so that I can read reach at a glance.
15. As an Account, I want "Copy link" to confirm that it copied, so that I know the click worked.
16. As an Account, I want the Channel's name to show its Posts alone and its handle to open it in Telegram, so that both destinations are one click away.
17. As an Account, I want a forwarded Post's source, when I follow it, to open that Channel's Posts alone, and when I do not, to offer to add it, so that a forward leads somewhere useful either way.
18. As an Account, I want a reply's reference to show the start of the replied-to Post and link to it, so that I know what it answers.
19. As an Account, I want everything the card does today kept: the post id link, the time with the exact date on hover, media badges, the long-post collapse, search highlighting, Links, translation and find related.

### Channel spotlight

20. As an Account, I want to show one Channel's Posts alone from any of its cards, so that I can read around a Post without changing my Channel selection.
21. As an Account, I want the spotlight to show every Post of that Channel in the window by default, so that my other filters do not hide what I came to see.
22. As an Account, I want a "Keep my filters" switch in the spotlight, so that I can narrow it with what I had.
23. As an Account, I want "Back to feed", or Escape, to return me to the card I came from, so that a spotlight is a detour, not a new place.
24. As an Account, I want the spotlight never to change what my next Summary covers, so that reading around is safe.

### Compact grid and keyboard

25. As an Account, I want a Compact grid that fills the width with as many columns as fit, in feed order, so that I can scan many Posts at once.
26. As an Account, I want compact cards to keep every action, the photo (smaller, centred) and three lines of text with "More", so that scanning loses nothing I need.
27. As an Account, I want compact cards in a row to line their footers up, so that the grid reads as a grid.
28. As an Account, I want a Keyboard mode where j and k select the next and previous Post, so that I can read without the mouse.
29. As an Account, I want single keys on the selected Post (p photo, f this Channel alone, t translate, r find related, c copy link, o open in Telegram, x select or deselect), so that every action is one key away.
30. As an Account, I want a card listing those keys while Keyboard mode is on, so that I do not have to remember them.
31. As an Account, I want the keys to stay quiet while I type in a field or have a dialog open, so that typing never fires an action.
32. As an Account, I want both switches to last for my browser session, so that a reload keeps them and a new session starts plain.

### The Post filter

33. As an Account, I want Type, Media and Language as dropdowns with a search and a row per value, so that they work like the Channels tab's Groups, Tags and Languages.
34. As an Account, I want a funnel on each row that shows only Posts with that value, and a second funnel in the same dropdown to widen it with OR, so that funnelling reads naturally.
35. As an Account, I want a Filters menu to add a bound on Views or on Estimated views (at least, at most, between, or no value), so that I can filter on reach the way Channels filters on numbers.
36. As an Account, I want every active Condition shown as a chip in a filter row, so that I can see the whole filter at once.
37. As an Account, I want to negate any chip or group, so that I can say "not Persian" or "not (forwarded or video)".
38. As an Account, I want to switch the joiner between two blocks from AND to OR, so that I can say "Persian or English".
39. As an Account, I want to put chips in parentheses and drag a chip onto another to group them, so that I can build "(Persian and video) or (views over 10K)".
40. As an Account, I want a "+" in the row and inside every pair of parentheses, so that I can add a Condition exactly where it belongs.
41. As an Account, I want a chip's label to reopen its picker on that Condition, so that I can change a value without rebuilding the block.
42. As an Account, I want the row to say how many Posts in the window the filter shows, exactly, so that I know what it does.
43. As an Account, I want the keyword search shown as a chip in the row, so that it is visibly part of the filter.
44. As an Account, I want "Clear all" in the row, so that one click returns me to the whole window.
45. As an Account, I want a Post with no Language, or no View count, to fail a Condition on it and pass its negation, so that "not Persian" includes Posts whose Language is unknown, as on Channels.
46. As an Account, I want the filter in the URL, so that a reload keeps it and a link shares it.
47. As an Account, I want sort to be one searchable Sort menu (Post date, Views, Estimated views) and a direction arrow, as on the Channels tab, so that both tabs sort the same way.
48. As an Account, I want the views sort to read its own measure, independent of any views bound in the filter, so that sorting by Views never changes what a bound means.
49. As an Account, I want the per-Channel cap and the grouping to keep working as they do today, so that nothing I rely on disappears.
50. As an Account, I want commands in the palette that used to set a Type, media kind or Language to add the same Condition to the Post filter, so that my shortcuts still work.

### The Post selection

51. As an Account, I want every Post in the window selected by default, so that if I do nothing the app behaves as it did before.
52. As an Account, I want a checkbox on every card, ticked when the Post is selected, so that I can see and change what my next Summary covers.
53. As an Account, I want unticking one Post to deselect that exact Post only, wherever it appears, so that "not this one" means this one.
54. As an Account, I want shift-click to tick or untick every Post between my last click and this one, so that I can pick a run of Posts quickly.
55. As an Account, I want "Select all" and "Deselect all" for what the filter shows, recorded as a rule, so that "deselect all Arabic Posts" also deselects the Arabic Posts of the next window.
56. As an Account, I want a tick on a dropdown row (for example Arabic) to select or deselect every Post with that value in the window, whatever the filter shows, recorded as a rule, so that I can drop a whole Language from my Summary while still reading it.
57. As an Account, I want each dropdown row to show how many of its Posts are selected out of how many, and the tick to read all, some or none, so that I can see a value's state at a glance.
58. As an Account, I want my rules and Picks shown in order as chips ("Select all · Deselect Arabic · −3 posts"), so that I can always see why a Post is in or out.
59. As an Account, I want to remove any chip, so that I can undo one step without undoing the rest.
60. As an Account, I want the last step to reach a Post to decide it, so that the result always matches what I did most recently.
61. As an Account, I want "Select all" or "Deselect all" over an empty filter to replace every step before it, so that the chips stay short.
62. As an Account, I want a rule made under "5 random per Channel" to give the same Posts every time in the same window, so that a reload never reshuffles my Summary.
63. As an Account, I want selecting everything a meaning search found to record those exact Posts, not a rule, so that it never re-runs a search behind my back.
64. As an Account, I want a deselected Post still shown in the feed, dimmed, so that the selection marks Posts and never hides them.
65. As an Account, I want a "Selected first" switch, as on the Channels tab, that lists the selected Posts the filter shows before the rest, in the feed's own order, so that I can review my selection in place.
66. As an Account, I want the Channels tab's Adjust selection Venn here, its presets recorded as rules, so that "keep only what is shown" or "add what is shown" works the same on both tabs.
67. As an Account, I want the selection bar to say how many Posts are selected out of how many in the window, so that I know what my Summary will cover.
68. As an Account, I want Summarize and Chat to cover my whole Post selection, never only what the filter shows, so that reading around never narrows an Artifact.
69. As an Account, I want "Copy links" and "Export Markdown" for the selected Posts the filter shows, so that I can take a set of Posts elsewhere.
70. As an Account, I want my Post selection to survive a reload and a tab switch for the rest of my browser session, so that I do not lose work, and to start fresh in a new session.
71. As an Account, I want my rules to be applied again when I change the window or the selected Channels, and my Picks to stay with their Posts, so that the selection means what I said.
72. As an Account, I want a limit on how many single Posts I can pick, with a suggestion to use a rule instead, so that the selection stays fast.
73. As an Account, I want the Channels tab's "Posts in scope" to count only my selected Posts, so that it says what a Summary of that Channel would read.

### Artifacts and History

74. As an Account, I want every Artifact to record the rules and Picks it was made with, so that I can restore the selection later.
75. As an Account, I want every Artifact to record exactly which Posts it covered, as references, so that inspecting it never re-applies rules to today's corpus.
76. As an Account, I want an Artifact made before this change to keep showing the filters it was made with, so that old records stay readable.

### Accounts, View-as and the Operator

77. As an Account, I want my Post selection, Compact grid and Keyboard switches kept apart from anyone else signed in on the same browser, so that a shared machine leaks nothing.
78. As an Owner viewing as another Account, I want that Account's session state rather than mine, so that View-as shows what they see.
79. As an Account, I want a Pick or rule never to reach a Post of a Channel I do not follow, so that the selection cannot be used to read another Account's corpus.
80. As the Operator, I want the filter and selection sent by the browser bounded in size, so that a crafted request cannot build an expensive query.

## Implementation Decisions

### The card and the photo viewer

- The card is rebuilt as the prototype's card A, not promoted from it. It keeps every capability
  of today's card (story 19); the prototype's `PostCardPrototype` lists them. Today's split into
  identity, body, media and actions parts stays, re-arranged: header (avatar, Channel name, handle,
  time, post id, reply and forward references), photo, body, media badges, footer (views,
  reactions, actions).
- The photo on the card keeps today's sizing rule (never wider than the card, at most 20rem tall,
  shape kept, framed and centred), moved above the text. A compact card caps it at 10rem.
- The photo viewer is one component: a dialog sized in viewport units so the photo is
  `object-contain` in it at 1x. Zoom is a transform about the pointer, clamped to 1x to 8x; pan is
  clamped to the photo's drawn size, not the viewer's, so a narrow photo stays centred sideways.
  The wheel listener is non-passive so a trackpad pinch zooms the photo, not the page. A plain
  click at 1x closes after a short delay that a double-click cancels.
- The gallery steps through the photos the feed has loaded, in feed order. Each step starts at
  1x. Closing scrolls the feed to the last photo's Post; the dialog's return focus is suppressed so
  it does not scroll straight back.
- The photo is still the cached thumbnail; there is no larger image to load. The viewer upscales
  it with `object-contain`, which keeps its shape.
- Reactions show the four most frequent chips and "+N"; a paid chip shows as a star, a custom
  emoji as a neutral glyph. Counts use the existing count formatter.

### Channel spotlight

- A spotlight is the Post filter replaced by a single Channel Condition, or joined with AND to it when
  "Keep my filters" is on. The filter the Account had is remembered and restored by "Back to
  feed" or Escape, and the feed scrolls back to the card the spotlight started from.
- The Post filter therefore gains a **Channel** Condition. It is also what makes a rule made in a
  spotlight mean "every Post of this Channel".
- A spotlight drops the per-Channel cap and the grouping while it is on.

### Compact grid and keyboard

- Compact grid lays the feed out as an auto-fill grid of columns at least 22rem wide; compact cards
  put the actions in a footer pinned to the bottom of the card.
- Keyboard mode marks the selected card with an attribute and moves it with j and k; each action
  button carries the letter it answers to, and a key fires the button in the selected card. Keys
  are ignored with a modifier held, in a text field, or while a dialog is open; the arrow keys
  belong to the photo viewer while it is open.
- Both switches are browser-session state namespaced per Account (see Storage below).

### The shared filter components

- The Channels filter's tree model, facet dropdown, filter row and condition picker become one
  shared tree module and three shared components, parameterised by a vocabulary per tab. The
  Channels tab moves onto them with no change in behaviour; its tests must pass unchanged. The
  prototype already did this move, and its shape is the one to rebuild:

  ```ts
  // From the prototype: what a tab tells the shared picker and row.
  type PickerVocabulary<C> = {
    sections: { heading?: string; entries: PickerEntry<C>[] }[]
    entryOf: (cond: C) => string
  }
  type PickerEntry<C> =
    | { kind: "list"; id: string; label: string; icon: Icon;
        options: { id: string; label: string; hint?: string }[];
        make: (value: string) => C; current: (cond: C) => string | undefined }
    | { kind: "editor"; id: string; label: string; icon: Icon;
        render: (p: { start?: C; onSubmit: (c: C) => void; onBack: () => void }) => ReactNode }
  type FilterVocabulary<C> = PickerVocabulary<C> & {
    label: (cond: C) => string
    icon: (cond: C) => Icon
    chipId: (cond: C) => string
  }
  ```

- The facet dropdown takes rows carrying their own `selected`, `total` and tick state, so the
  Channels tab and the Posts tab each compute them their own way.

### The Post filter

- A Post Condition is one of Type, media kind, Language, Channel, or a bound on Views or Estimated
  views. The tree nodes carry `not`, and the browser's `id` round-trips untouched. From the
  prototype, with Channel added:

  ```ts
  type PostCond =
    | { type: "type"; value: "forwarded" | "original" | "unfollowed_forwarded" }
    | { type: "media"; value: MediaKind }
    | { type: "language"; value: string }
    | { type: "channel"; value: string }   // added for the spotlight
    | { type: "views"; measure: "views" | "estimated";
        min?: number; max?: number; none?: boolean }
  ```

- The Post filter is that tree, the keyword search and the per-Channel cap (with its mode and
  seed). It is view-only: it never enters the Scope.
- **The server evaluates the tree.** The backend tree prototyped on the branch (a request schema
  bounded at depth 6 and 100 nodes, and a SQL clause where every atom is `coalesce(…, false)` so
  NOT is two-valued) is the starting point. The Channel Condition is added, and its values are
  checked against the Account's Follows like every other Channel reference. The browser never
  evaluates the tree; the prototype's loaded-pages evaluator is not carried forward.
- The feed, counts and facets reads take the Post filter instead of today's flat `forwarded`,
  `media`, `languages`, `views` fields, which are removed (ADR-026: no migration into rules; the
  old filters become view-only). A Discovery report's Scope input changes the same way.
- Facet rows report, per value, how many Posts in the window have it and how many of those are
  selected, filters aside, because a tick ignores the filter.
- The tree is in the URL as text, `?postFilter=`, with the Channel filter's printer and parser
  shape; a malformed string is ignored. The keyword stays in the search box's state and the cap
  where it is today.
- The settings keys for the retired flat filters are retired through the settings registry, with
  their classification removed rather than left dangling.
- Sorting is the Channels-style Sort menu plus a direction. The views orders gain their own
  measure, separate from any bound, so the Scope's order no longer reads a filter's measure.

### The Post selection

- The wire shape is an ordered list of steps; a Selection rule carries the Post filter it was
  made with:

  ```ts
  type SelectionStep =
    | { kind: "rule"; select: boolean; filter: PostFilterSnapshot }
    | { kind: "pick"; select: boolean; channelName: string; postId: number }
  // The default and the result of an unfiltered select-all.
  const DEFAULT: SelectionStep[] = [{ kind: "rule", select: true, filter: EMPTY }]
  ```

  `PostFilterSnapshot` is the tree, the keyword, and the cap with its mode, seed and the order an
  ordered cap follows. A rule made under a random cap keeps the seed it was made with.
- Evaluation, on the server: a Post is selected if the last step that reaches it selects it, and
  unselected if no step reaches it. A rule reaches the Posts its filter matches in the current
  window and Channels; a Pick reaches its one Post.
- Compaction happens where steps are appended: a select-all or deselect-all over an empty
  filter replaces the list. Removing a chip removes its step and nothing else.
- Picks are capped at 5,000; the request is refused past it and the UI suggests a rule. The
  request schema bounds the number of rules and each rule's tree with the Post filter's bounds.
- Every read the Posts tab makes returns each Post with a `selected` flag computed from the
  selection the request carried, including the lookup the meaning search uses. The feed also
  takes `selectedFirst`, ordering the selected Posts first within the feed's own order, and
  `onlySelected`, which copy and export use (up to 5,000).
- Counts report the selected count alongside the shown count; the Channels tab's "Posts in scope"
  reads the selected count.
- The Venn reuses the Channels component without the action limit, which the Posts tab does not
  have. Its regions come from the server's counts. Its presets map to rules over the current filter
  (add shown: select F; remove shown: deselect F; keep only shown: deselect NOT F; select only
  shown: deselect all then select F). "Invert shown" cannot be expressed as rules and is not
  offered; the Venn does not offer the one region picture that would need it.
- Selecting all of a meaning search's results appends one Pick per result instead of a rule.
- **The Scope.** `ScopeSubmission` carries the Post selection instead of the flat filters and
  the explicit `posts` list (a legacy submission naming posts is read as deselect-all followed by
  those Picks, for one release). The order and grouping stay in the Scope. Every Action (Summary,
  Chat, Tag run, Discovery report) resolves the selection on the server.
- **The frozen Scope.** An Artifact stores its rules and Picks with the Scope, and the
  `(channelName, postId)` reference of every Post the selection reached in the companion payload
  table, as `scope_posts` is today, with no 5,000 bound. Post text is never copied. Artifacts made
  before this change keep their old Scope fields, read-only, and show them as they were.
- **Tenancy.** Rule evaluation runs inside the existing follow-scoped seam, and a Pick naming a
  Channel the Account does not follow reaches nothing and is not an error. Each new or changed
  route is probed in the account-isolation guard.

### Storage

- The Post selection and the two switches live in session storage, namespaced per Account
  (`u:<userId>:`), through a session counterpart added to the existing scoped storage module. The
  browser storage guard counts session storage too, so no other module may touch it, and the guard
  is not changed.
- A View-as session reads and writes the target's namespace, as every other scoped key does.

## Testing Decisions

- A good test drives behaviour an Account relies on and asserts what comes out: which Posts are
  shown, which are selected, what a request carried, what an Artifact froze. Not how a component
  or a query is built. Each guard is mutation-tested before it is trusted.
- **Seam 1, the backend's public routes** (pytest against real Postgres; prior art: the posts
  route tests, the Channels bulk-follow route tests, `test_account_isolation.py`, the projection
  tests). Everything server-side is asserted through the posts reads and the Action submissions:
  - The tree: AND, OR, NOT, nesting, empty groups; NOT on a Post with no Language and no View
    count; a bound under each measure; the Channel Condition; the size bounds answering 422.
  - The selection: the default selects everything; last step wins between a rule and a Pick in
    both orders; compaction; a random-cap rule giving the same Posts twice in one window and
    re-applying in another; a meaning-search select-all recorded as Picks; the Pick cap.
  - `selected` on every Post, `selectedFirst` ordering, `onlySelected`, the selected counts,
    facet selected/total, and "Posts in scope".
  - An Action: Summarize over a selection covers exactly the selected Posts; the Artifact freezes
    the steps and the references; inspecting it later returns the same Posts after the corpus
    changed; an old Artifact keeps its old fields.
  - Isolation: a Pick or a Channel Condition naming a Channel the Account does not follow reaches
    nothing; the account-isolation guard probes every changed route; the projection tests are
    updated for the new response fields.
- **Seam 2, frontend pure modules** (`bun test`; prior art: the Channel filter, selection regions
  and trim tests). The shared tree module through the existing Channels tests, unchanged; the
  Post selection steps (append, compaction, chip removal, Pick cap, the request it produces); the
  Post filter's URL form (print then parse gives the same tree, a malformed string is ignored);
  the session storage counterpart's namespacing.
- **Seam 3, component tests** (testing-library in `bun test`; prior art: the channel grid parts
  and filter row tests), one per new branching component, asserting behaviour: the Posts facet
  dropdown's tick and funnel; the filter row over Post Conditions; the rule chips; the card
  checkbox and shift-click range; the photo viewer's zoom, clamped pan, gallery step and close;
  the keyboard handler's ignore rules. The frontend CRAP ratchet in CI fails a new branching
  component without one.
- **Seam 4, one end-to-end journey** (Playwright with a mocked API, a new Posts spec beside the
  other `summarizer-*` specs, run serially): build a filter with a NOT and parentheses and see the
  request carry it; tick Arabic in the Language dropdown and see a Deselect rule chip; untick one
  Post and see a Pick chip; change the window and see the rule re-applied in the request while the
  Pick stays; switch Selected first; run Summarize and see the request carry the whole selection;
  reload and find the filter in the URL and the selection still there. Existing specs that drive
  the old pills are updated in the same change.

## Out of Scope

- A text box for typing a Post filter. The text form is in the URL but never typed.
- Saved or named Post filters or Post selections.
- A Post selection that outlives the browser session or follows the Account across devices.
- Migrating today's flat filters into rules (ADR-026).
- An action limit on the Posts tab; Actions always take the whole Post selection.
- "Invert shown" in the Posts Venn.
- A larger image than the cached thumbnail, and two-finger pinch on touch screens.
- The views histogram in the Filters menu's editor. The editor ships with fields and operators;
  a server histogram endpoint is its own follow-up, and the prototype's 2,000-Post sample must not
  ship.
- Undo for a selection edit.

## Further Notes

- The prototype is throwaway. Rewrite it properly rather than promoting it: it evaluates the tree
  in the browser over loaded pages, keeps the selection as an explicit set rather than steps,
  stubs Summarize and Chat with a toast, keeps every losing variant behind `?variant=`, and its
  views editor samples 2,000 Posts. Its shared filter components and tree module, and the backend
  tree, are the closest to reusable; the backend tree has no tests yet.
- The prototype's decision trail is in the conversation that produced it and in
  `docs/post-filter-tree-plan.md` on the branch, which this spec supersedes.
- The Channels tab's facet "tick selects" and the Posts tab's differ on purpose: a Channels tick
  edits the Channel selection directly, a Posts tick records a Selection rule.
- ADR-026's main consequence is the one most likely to be "fixed" by mistake: a Summary does not
  follow the visible filter.
