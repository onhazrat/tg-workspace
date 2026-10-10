# Summary tab redesign, Publications, and the photo viewer on phones

Status: ready-for-agent

Ticket prefix: `SUMTAB`.

Settled in a grilling session on 2026-10-10, after a prototype on a local branch
(`t3code/summary-tab-prototype`, never pushed: its history names the staging deployment). The
prototype's chosen variant is "X". No ADR: every decision reverses at the cost of a ticket, and the
glossary carries the reasons. The new terms (Covered Post, Citation, Cited Post, Publication, Part)
are in `CONTEXT.md`, the first three under Artifacts and the last two under a new Publishing heading.

## Problem Statement

Reading a Summary means reading prose full of `[channel #1234]` Citations with nothing behind them:
hovering one shows text only, no photo, and a long Post is cut off with no way to scroll. Nothing on
the tab says which Channels the Summary actually drew on, how many of each Channel's Posts it was
given, or which of those it cited, so a reader cannot tell whether a Summary leans on three loud
Channels or ignored a large one. The header spends two rows on uppercase chips and a boxed toolbar,
and the Analysis window it was made from sits at the very bottom.

Publishing to Telegram is worse, and the scheduler does it unattended:

- The text is cut every 4,000 characters wherever that lands: mid-word, mid-bold, mid-link.
- Every bullet the AI writes as `* **Label:** text` arrives broken. The parser reads `* *` as an
  empty italic and `*Label:*` as italic, so the bullet and the bold both vanish, leaving stray
  asterisks. On one real Summary that is 55 stray italic spans across 21 bullets.
- The metadata's `*Time Range:*`-style labels arrive italic, not bold, because the parser sends a
  single-asterisk pair as italic.
- The metadata's channel list (`@news_ir, @foo_bar`) pairs its underscores into italics and drops
  them, mangling the handles.
- Because every Citation is a link, Telegram attaches a link-preview card of the first cited Post
  under every message.
- The scheduler prints the metadata's time range in raw UTC with no zone; the browser prints it in
  local time, in a different format, also with no zone. Two copies of the metadata generator have
  drifted apart.
- A failure halfway through leaves an unknown number of messages sent, and nothing to finish with.

On a phone, the full-size photo viewer (shared by the Posts feed, the Channels grid, Channel
avatars, and now the Summary tab) cannot be pinch-zoomed at all: it disables the browser's pinch and
handles only one pointer itself. Double-tap relies on the browser's `dblclick`, and a single tap at
1x closes the viewer, so a stray touch throws the reader out.

Two smaller defects: the "Generating Summary…" spinner covers whichever workspace tab is active, not
only the Summary being generated; and on phones the workspace shell's padding costs every tab 64px
of width.

## Solution

The Summary tab becomes a reading surface that shows its sources:

- A **two-line header**: the title with icon actions beside it, then one line with the Analysis
  window (duration, the range in the reader's zone, the zone's city), the number of Channels and the
  number of Covered Posts, and a muted line with the AI model, Output language and how long ago it
  was generated.
- A **photo strip** of the Cited Posts that have a photo, in the order the prose first cites them,
  running in the Summary's reading direction. A tap opens the photo full size, where "Find in
  report" jumps to the Citation; a corner Locate button on each tile does the same without opening
  it.
- **Reading controls**: text size S/M/L, remembered per Account, and a fold chevron per section.
- **Citation hovers** that show the Cited Post as a card, photo included, scrolling inside when long.
  On a phone or any device without hover, tapping a Citation opens the card in a bottom sheet. A
  Citation to a Post outside the Summary's Scope says so.
- A **coverage wall**: every Channel in the Scope (and any cited Channel outside it) as an avatar
  with a small split badge growing out of the photo's bottom-right corner: Cited Posts in blue, then
  Covered Posts in grey. Channels are ordered by Cited Posts, Covered Posts breaking ties. Tapping an
  avatar highlights that Channel's Citations in the report and opens a side sheet (a bottom sheet on
  phones) listing every Post that Channel gave the Summary as full post cards: "Cited in the
  summary" first, each outlined with a Find button, then "Also covered".
- A **publish panel**: bot, destination and the Publish button first; then the metadata switch with
  its row checklist; then a preview of the exact Parts the server will send.

Publishing becomes a server-side **Publication**, the same for a person and for the scheduler: the
server plans the Parts (cut between paragraphs, formatting fixed, citation style applied, metadata in
the Account's time zone), the panel previews that plan, and the send delivers exactly those Parts. A
Publication that fails partway stops, is recorded as partial, and the Summary tab offers to send the
remaining Parts.

The photo viewer learns touch: two-finger pinch zooms about the fingers' midpoint, its own
double-tap detection toggles zoom, a one-finger swipe left or right at 1x steps between photos (in
the reading direction), a swipe down closes, and a tap shows or hides the controls. A mouse click at
1x still closes, as today.

## User Stories

### Reading a Summary

1. As a reader, I want the Analysis window, the number of Channels and the number of Covered Posts directly under the title, so that I know what the Summary is about before I read it.
2. As a reader, I want the Analysis window's times in my own zone with the zone named, so that "9:27 AM" names a moment and not a guess.
3. As a reader, I want the date written once when both ends of the window share it, so that the range reads at a glance.
4. As a reader, I want the window's duration first, so that I see "3h" before I parse two timestamps.
5. As a reader, I want the AI model, Output language and age on a quieter line, so that provenance is there without competing with the scope.
6. As a reader, I want note, re-analyze, copy and export as icon buttons beside the title, so that the header takes half the height it does now.
7. As a reader using a screen reader, I want every icon action to have a spoken name, so that the icons are not a guessing game.
8. As a reader, I want the photos from the Cited Posts in a strip near the top, so that I see the visual evidence before the prose.
9. As a reader, I want the strip in the order the prose first cites each Post, so that the photos follow the story.
10. As a reader of a right-to-left Summary, I want the strip to run right to left, so that the first-cited photo is where my eye starts.
11. As a reader, I want to tap a strip photo and see it full size, so that I can read the text in a screenshot or see detail.
12. As a reader viewing a photo full size, I want "Find in report", so that I can jump to where the Summary cites it.
13. As a reader, I want a small Locate button on each strip tile, so that I can jump to the Citation without opening the photo.
14. As a reader, I want to step through every strip photo in the full-size viewer, so that I can browse them all without closing it.
15. As a reader, I want to pick a text size of S, M or L, so that a long Summary is comfortable on my screen.
16. As a reader, I want my text size remembered, so that I do not set it on every Summary.
17. As a reader, I want to fold a section, so that I can skip what I have read.
18. As a reader, I want to hover a Citation and see the Cited Post as a card with its photo, so that I can check the claim without leaving the page.
19. As a reader, I want a long Cited Post to scroll inside the hover card, so that I can read all of it.
20. As a reader on a phone, I want tapping a Citation to open the Cited Post in a bottom sheet, so that I can read it where hover does not exist.
21. As a reader, I want the Cited Post as it is now, with current views and edits, so that I see today's state.
22. As a reader of an old Summary, I want a deleted or aged-out Cited Post shown from the snapshot the Summary kept, so that old Summaries still show their evidence.
23. As a reader, I want a Citation to a Post outside the Summary's Scope flagged, so that I notice when the AI cited something it was not given.
24. As a reader, I want jumping to a Citation to scroll it into view and briefly highlight it, so that I find it on the page.
25. As a reader on a phone, I want that jump to work even straight after closing the viewer or a sheet, so that "Find" does what it says.

### Coverage

26. As a reader, I want every Channel in the Scope shown as its avatar, so that I see the whole set the Summary drew on.
27. As a reader, I want each avatar to say how many of that Channel's Posts were cited and how many it gave the Summary, so that I can judge each source's weight.
28. As a reader, I want that as one small split badge, cited in blue then covered in grey, so that it reads as a pair and stays out of the photo.
29. As a reader, I want the badge to grow outward from the photo's bottom-right corner, so that a wide count never covers the face or logo.
30. As a reader, I want Channels ordered by Cited Posts, then by Covered Posts, so that the sources the Summary leaned on come first and a big Channel it ignored is easy to spot.
31. As a reader, I want never-cited Channels greyed out but still showing their Covered Posts, so that "gave 37 Posts, none cited" is visible.
32. As a reader, I want a header line such as "18 of 51 channels cited · 679 posts used", so that I get the totals at a glance.
33. As a reader, I want a legend that explains the badge with an example sentence, so that I understand "2 │ 12" without guessing.
34. As a reader, I want a Channel that was cited but is outside the Scope shown and flagged, so that I notice the AI went beyond its input.
35. As a reader of a Summary made before Covered Posts were recorded, I want the wall to show only Citations and say the input was not recorded, so that a missing number is not read as zero.
36. As a reader, I want tapping an avatar to highlight that Channel's Citations and photos in the report, so that I can follow one source through the text.
37. As a reader, I want tapping an avatar to open every Post that Channel gave the Summary, so that I can see what the AI read and what it chose.
38. As a reader, I want the Cited Posts first under "Cited in the summary", so that the chosen Posts lead.
39. As a reader, I want the rest under "Also covered", so that I can see what was read but not used.
40. As a reader, I want each Cited Post in that sheet outlined and labelled, with a Find button, so that I can jump to its Citation.
41. As a reader, I want the sheet to show full post cards, so that I can read each Post properly.
42. As a reader on a phone, I want that sheet as a bottom sheet, so that it fits my screen.
43. As a reader of a Channel with hundreds of Covered Posts, I want the sheet to load 20 at a time as I scroll, so that it opens quickly.
44. As a reader, I want a never-cited Channel's avatar to open its Covered Posts too, so that I can see what it offered.

### Publishing

45. As a publisher, I want to pick the bot and destination and press Publish at the top of the panel, so that the common case takes one tap.
46. As a publisher, I want the button to say how many Parts it will send and where, so that I know what is about to happen.
47. As a publisher, I want to see each Part exactly as Telegram will show it, so that nothing surprises me after sending.
48. As a publisher, I want the preview to be the server's plan, so that what I preview is what is sent.
49. As a publisher, I want long Summaries cut between paragraphs, so that no Part ends mid-word, mid-bold or mid-link.
50. As a publisher, I want a heading kept with the paragraph it heads, so that no Part ends on a lonely heading.
51. As a publisher, I want a paragraph too long for one Part cut at a line, then a sentence, then a word, so that the cut is the least damaging one available.
52. As a publisher, I want each Part's length against Telegram's limit shown, so that I understand why there are three.
53. As a publisher, I want bullets to arrive as bullets with their bold labels, so that the published Summary looks like the one I read.
54. As a publisher, I want metadata labels bold, so that the metadata reads as labels and values.
55. As a publisher, I want @handles in the metadata to keep their underscores, so that the channel list names real Channels.
56. As a publisher, I want those three fixes applied without asking, so that I never have to know the parser has these quirks.
57. As a publisher, I want to choose how Citations appear (as written, by Channel name, or numbered), so that published Summaries suit my audience.
58. As a publisher, I want that choice remembered for my Account, so that every Publication, scheduled ones included, uses it.
59. As a publisher, I want numbered Citations to keep one numbering across the metadata and the prose, so that [3] means one Post.
60. As a publisher, I want link-preview cards off by default, so that my channel does not show a random cited Post under every message.
61. As a publisher, I want to turn link previews back on for my Account, so that I can have them if I want them.
62. As a publisher, I want metadata off by default, so that a Publication is the Summary alone unless I ask.
63. As a publisher, I want the metadata choice saved per Summary, so that its scheduled Publications follow what I chose.
64. As a publisher, I want to choose which metadata rows to send (time range, Channels used, Channel list, AI model, Posts analyzed) and see each row's value, so that I send only what matters.
65. As a publisher, I want to edit the metadata as text, or reset it to the generated text, so that I can say something specific.
66. As a publisher, I want the option to put the metadata in the first Part when it fits, so that a short Summary is one message.
67. As a publisher, I want the metadata's time range in my Account's time zone with the zone named, so that my readers know which moment it was.
68. As a publisher, I want my time zone taken from my browser the first time and editable afterwards, so that it is right by default and stays put when I travel.
69. As a publisher, I want a Publication that fails partway to stop and say how many Parts went out, so that I know what my channel received.
70. As a publisher, I want to send the remaining Parts of a partial Publication, so that I can finish it without re-sending what is there.
71. As a publisher, I want a partial scheduled Publication offered for finishing on the Summary tab, so that an unattended failure is not lost.
72. As a publisher, I want one publish-log entry per Publication, so that my logs show what happened, not one row per message.
73. As a publisher, I want the free-text quick message in Settings to get the same paragraph cuts and fixes, so that it does not mangle either.
74. As an Owner viewing someone's Account, I want planning a Publication to need no elevation and sending one to need the spend tier, so that viewing stays harmless and spending stays explicit.
75. As an Account, I want a Publication refused for someone else's Summary or bot, answering as if it did not exist, so that ids cannot be probed.

### Scheduled Publications

76. As an Account with an auto-publishing Summary, I want scheduled Publications planned exactly like manual ones, so that my channel gets the same cuts and fixes.
77. As an Account, I want scheduled metadata in my time zone, so that it no longer prints raw UTC.
78. As an Account, I want scheduled Publications to follow my citation style and link-preview settings, so that I configure it once.

### The photo viewer on phones

79. As a phone user, I want to pinch with two fingers to zoom a photo about my fingers, so that I can read small text in it.
80. As a phone user, I want to double-tap to zoom in and double-tap again to zoom out, so that I have a one-handed zoom.
81. As a phone user, I want to drag a zoomed photo to pan it, so that I can look around it.
82. As a phone user, I want to swipe left or right at 1x to go to the next or previous photo, so that I browse like any photo app.
83. As a phone user reading a right-to-left Summary, I want the swipe direction to follow the reading direction, so that "next" matches the strip.
84. As a phone user, I want to swipe down to close the viewer, so that closing is a deliberate gesture.
85. As a phone user, I want a single tap to show or hide the caption, arrows and close button, so that I can see the photo clean, and a stray tap does not close it.
86. As a desktop user, I want a click at 1x to keep closing the viewer and the wheel or trackpad to keep zooming, so that nothing I rely on changes.
87. As a phone user, I want the caption to fit my screen and its hint to name touch gestures, so that it neither overflows nor tells me to "scroll".
88. As a phone user, I want these gestures wherever the viewer opens (Posts feed, Channels grid, Channel avatars, Summary tab), so that it behaves the same everywhere.

### Two fixes

89. As a reader, I want the "Generating Summary" spinner only over the Summary being generated, so that I can keep working in other tabs.
90. As a phone user, I want the workspace's side padding reduced on narrow screens, so that every tab gets its width back.

## Implementation Decisions

### Slices

Each of these is its own ticket. The photo viewer goes first and alone; it touches every tab and
depends on nothing else. Only the Publication slice changes the backend.

1. The photo viewer on phones.
2. The citation hover and its phone sheet.
3. The two-line header.
4. The photo strip.
5. The reading controls.
6. The coverage wall and the Channel posts sheet.
7. Publications: the server-side plan and send, the per-Account settings, and the publish panel.
8. The spinner and the shell padding (two small tickets).

The redesign **replaces** the current Summary tab for everyone. There is no toggle and no second
layout.

### The photo viewer

- Gestures are recognised inside the viewer's pan-and-zoom surface, which keeps
  `touch-action: none` so the browser never zooms or scrolls the page underneath.
- The surface tracks every active pointer, not one. With two pointers down, the scale follows the
  ratio of the current finger distance to the starting distance, about the starting midpoint,
  through the existing zoom-about arithmetic; lifting one finger hands over to a one-finger pan
  without a jump. A pinch never counts as a tap.
- Double-tap is detected by the viewer from two taps close in time and space, not from `dblclick`.
  It toggles the existing 2.5x zoom about the tap point.
- At 1x a mostly-horizontal one-finger swipe past a threshold steps to the next or previous photo;
  "next" follows the reading direction of the page the viewer was opened from. A mostly-downward
  swipe past a threshold closes. Above 1x, one finger pans and neither swipe applies.
- On touch, a single tap (once the double-tap window has passed with no second tap) shows or hides
  the controls. A mouse click at 1x still closes, as today.
- The caption wraps to fit a phone screen, and its hint names the input in use: pinch and
  double-tap on touch, scroll and double-click with a mouse.
- The viewer accepts an optional action rendered over the photo on screen; the Summary strip uses it
  for "Find in report". The action receives the photo on screen and a way to close, and runs only
  after the dialog has fully gone, because the dialog's scroll lock outlives the close through its
  exit animation and swallows a scroll started earlier.

### Citations and the hover

- A Citation is `[channel #id]` in the prose. Cited Posts are resolved live through the existing
  batch Post lookup, falling back to the snapshot stored with the Summary for any that are gone.
- On devices with hover, a Citation shows the Cited Post as a full post card in a hover card whose
  height is capped to the space available, scrolling inside. With no hover or a narrow screen, a tap
  opens the same card in a bottom sheet.
- When the Summary has Covered Posts on record and a Cited Post is not among them, the hover and
  the sheet say it is outside this Summary's Scope.
- The Chat tab's citations are unchanged.

### Header, strip and reading controls

- The header's first line is the window's duration, the window range formatted with the
  locale's range formatter (which writes a shared date once), the reader's zone as its city, then
  "N channels · N posts" where N posts counts Covered Posts. When the Scope recorded no window, it
  says so.
- The strip lists Cited Posts that have a photo, in first-Citation order, in the Summary's reading
  direction. Each tile opens the viewer over the strip's photos and carries a corner Locate button.
- Text size is a per-Account setting in the frontend settings schema. Fold state is not stored.
  Sections are found from Markdown headings and from lines that are a single bold phrase, which is
  how the AI heads sections.

### Coverage

- Coverage is derived in the browser from data the tab already has: Citations from the prose, Cited
  Posts from the lookup, Covered Posts from the frozen Scope's Post references on the Summary
  detail. No backend change.
- The wall lists the union of the Scope's Channels and any cited Channel, the latter flagged as
  outside the Scope.
- Order (from the prototype):

  ```ts
  rows.sort((a, b) => b.citedPosts - a.citedPosts || b.coveredPosts - a.coveredPosts)
  ```

  where `citedPosts` counts distinct Cited Posts of the Channel (not Citations) and `coveredPosts`
  counts its Covered Posts.
- The badge is one pill: Cited Posts on a blue half (omitted when zero), Covered Posts on a grey half
  (omitted when the Scope recorded none). It is anchored a few pixels inside the photo's
  bottom-right corner and grows outward to the right; the wall's spacing leaves room for it.
- Tapping an avatar highlights that Channel's Citations and strip photos in the report (only if it
  has any) and opens the Channel posts sheet. Tapping it again closes both.
- The sheet loads the Channel's Covered Posts through the batch lookup: Cited Posts first, then the
  rest newest first, 20 at a time as the reader scrolls. It is a side sheet on wide screens and a
  bottom sheet on narrow ones. Cited Posts carry a blue outline and a "Cited in the report · Find"
  strip; Find closes the sheet and then jumps, as the viewer's action does.

### Publications (backend)

- A **Part builder** turns a Summary's prose and, when asked, its metadata into Parts. It is a pure
  transform and the only place cutting and formatting happen. Both the manual Publication routes,
  the quick message, and the scheduler call it.
- Formatting rewrites, applied before cutting, to every Publication and the quick message:
  - a line-start bullet (`* ` or `- `) becomes `• `;
  - a single-asterisk label after a leading emoji or word (`🕒 *Time Range:*`) becomes bold;
  - an @handle containing `_` becomes a link to the Channel with the handle as its text;
  - Citations follow the Account's citation style: as written (`[chan #id]`, already a link to the
    Post), by Channel name (`(chan, chan)`, each a link), or numbered (`[1][2]`, each a link, one
    numbering across the metadata and the prose). Links use the deployment's Telegram web base URL.
- Cutting (from the prototype): split the text into paragraphs on blank lines; glue a paragraph that
  is only a heading to the paragraph after it; split any piece still too long at lines, then at
  sentence ends, then at whitespace, then hard; then pack whole pieces greedily into Parts, keeping
  the separator that joined them. The limit is Telegram's, measured on the text after entity
  parsing, in UTF-16 units. The metadata is its own Part unless the Publication asks for it in the
  first Part and it fits.
- A Part whose cut still had to fall inside a word or a formatting pair (only possible for a single
  over-long word) is flagged in the plan.
- The **default metadata** is generated only by the backend, in the Account's time zone, naming the
  zone ("Oct 7, 2026, 9:27 AM – 12:27 PM (Asia/Tehran, GMT+3:30) · 3h"). The browser's copy of the
  generator is deleted. The rows are: time range, Channels used, Channel list, AI model, Posts
  analyzed (the Covered Post count).
- **Routes** (both owner-scoped by Summary id, each with its family's own 404 detail):
  - `POST /summaries/{id}/publication/plan`: given whether to include metadata and whether to put it
    in the first Part, returns the Parts the server would send (each with its kind (metadata,
    summary, or both), its text, its parsed length, and any cut flag) plus the generated default
    metadata text for the editor. Read-only, so it is declared as a view-as read-only path.
  - `POST /summaries/{id}/publication`: given bot credential, destination, and the same options,
    plans and sends. The bot credential is checked against the caller before it is decrypted, as the
    existing publish path does. Sending spends the Account's bot, so it is a view-as spend path.
  - Resuming a partial Publication is the same route given the partial Publication's id; it sends
    only that Publication's remaining stored Parts, never re-planned text.
- Each Part is sent with `link_preview_options.is_disabled` unless the Account's link-preview setting
  is on.
- **One publish-log row per Publication**, recording every Part's text as planned, how many were
  sent, and, when it stopped early, the failure. A Publication stops at the first failed Part.
- The existing free-text publish route stays for the quick message and gains the cuts and the three
  fixes. Citation style has nothing to act on there.
- The **scheduler** plans and sends through the same builder with the Account's settings, records
  partial Publications the same way, and never resumes one itself.
- **Send metadata** is the existing per-Summary flag. Its default becomes off for every Summary,
  existing ones included: a Summary sends metadata only when its flag was set on explicitly.

### Per-Account settings

Three new personal settings, each classified in the settings registry: **citation style** (as
written, by Channel name, numbered; default as written), **link previews** (default off), and **time
zone** (an IANA zone name; empty until the browser fills it from its own zone the first time, then
only changed by the Account in Settings). The scheduler reads them; the publish panel shows the
current citation style and link-preview choice with a link to the Publishing settings rather than
per-Publication switches.

### The publish panel

- Bot and destination pickers and the Publish button come first. The button names the Part count and
  the destination.
- Then: the send-metadata switch (saved per Summary); when on, the row checklist with each row's
  value, the "in the first Part when it fits" switch, and edit-as-text with reset to generated.
- Then: the preview, which renders the plan route's Parts as Telegram will show them, each with its
  length against the limit.
- When the Summary's latest Publication is partial, the panel says "Last Publication was partial: N
  of M Parts sent" with "Send the remaining K".

### The two fixes

- The generating spinner covers only the tab of the Summary being generated (or the new-Summary tab
  while it is being created), never another tab.
- The workspace shell's side padding shrinks on narrow screens for every tab.

## Testing Decisions

Good tests here drive behaviour from the outside and assert what a user or Telegram would see: the
Parts a plan returns, the requests a send makes, the order of avatars, what a gesture does to the
photo. They do not assert internal state, helper calls or class names.

- **The photo viewer component**, at the existing component test (Testing Library, synthetic pointer
  events). New cases: a two-pointer pinch scales about the midpoint and does not close; a quick
  double-tap toggles 2.5x without closing; a horizontal swipe at 1x steps photos, reversed in a
  right-to-left page; a downward swipe closes; a touch tap toggles the controls and does not close; a
  mouse click at 1x still closes; above 1x, one finger pans and does not step. The zoom arithmetic
  stays covered by the existing model tests, extended for pinch scale.
- **The Publication routes**, through the API test client with the outbound Telegram call faked
  (prior art: the route tests that fake `fetch_with_retry`, and the auto-publish scoping tests). The
  plan route alone covers: paragraph cuts, a heading never ending a Part, the line, sentence and word
  fallbacks, the three rewrites, each citation style including one numbering across metadata and
  prose, metadata in the first Part when it fits, the Telegram limit measured after parsing, and
  metadata in the Account's zone. The send route covers: one request per Part in order, link
  previews off and on, a failure at Part 3 of 5 recording a partial Publication, resuming sending
  exactly the remaining stored Parts, one publish-log row per Publication, and refusing a foreign
  Summary or bot as absent before any decrypt. The account-isolation probe and the view-as
  inventories must list both routes.
- **The scheduler**, at its existing seam, asserting it sends the same Parts the plan route returns
  for that Summary and Account, and that a Summary with no saved metadata flag sends no metadata.
- **The rendered Summary tab**, in the style of the existing Summary component tests, with the API
  faked: the header's two lines; the strip's order and its right-to-left direction; the coverage
  order, badges, out-of-Scope flag and the not-recorded state; the posts sheet's "Cited in the
  summary" then "Also covered" grouping; the citation hover and its phone sheet, live and snapshot;
  and a publish panel that renders whatever Parts the plan returns.
- **Settings**: the three new keys pass the settings-classification guard; the time zone is filled
  from the browser only when empty.
- No Playwright: touch gestures are not reliably emulated there, and the component level already
  reaches every behaviour above. Any Playwright mock of the Summary routes must be updated if a
  response model changes.

## Out of Scope

- Per-Publication overrides of citation style or link previews; they are Account settings.
- Editing Parts or placing cuts by hand.
- Changing how Summaries are generated, or the prompt.
- The Chat tab's citation hovers.
- Finishing a partial Publication automatically.
- Taking the time zone from the browser on every login.
- Keeping saved fold state.
- Any Playwright coverage of touch gestures.

## Further Notes

- **Release notes**, because both change what channels receive without anyone acting:
  - Scheduled Publications stop sending metadata unless the Summary's send-metadata flag was set on
    explicitly; the default is now off for every Summary.
  - Scheduled Publications no longer carry link-preview cards; an Account can turn them back on.
- The prototype validated the cutting and formatting rules on real Summaries (an English one of
  7,303 characters with 47 Citations, and a Persian one), including the three parser bugs. Its
  Python counterpart, a throwaway publish script with `linkPreview`, is not to be promoted.
- The prototype's frontend sent one publish call per Part as a workaround; the server-side
  Publication replaces that.
- The full-size viewer's caption overflowing a phone screen and the stray-tap close are bugs on
  `main` today, as is the missing pinch; slice 1 fixes all three for every tab.
