# Channel cards

Status: ready-for-agent

Ticket prefix: `CARD`.

Settled by a UI prototype against staging data and two rounds of grilling (2026-10-08). The
prototype tried variants A to G on the Channels tab; E won, as "D with stat tiles". Its final
state is the single commit on branch `prototype/channel-cards`: run the frontend and open the
Channels tab with `?variant=E` to see it, or `?variant=0` for the card as it is on `main`. The
term **Last sync** was added to `CONTEXT.md` for this work.

## Problem Statement

The Channels tab draws each followed Channel as a card in one of four sizes: tiles, compact
cards, cards and detailed cards. An Account working through a few hundred Channels hits the same
walls every day.

A compact card does not say when the Channel last synced, so finding a stale Channel means
switching to a bigger size. The bigger cards say it twice, in a body chip and in a footer that
also shows "Pending" or "Up to date", and that label is wrong after every page reload: it compares
against a newest post id that only the browser tab remembers, so every Channel reads "Pending"
until it syncs again in the same tab. The footer shows one next-sync time and hides whether it
belongs to the Regular or the Dynamic schedule.

Tagging is slow. "+ Add Tag" opens a field that has no focus, so the first click does nothing
visible and a second is needed before typing. It offers no completion, unlike the bulk bar's tag
fields, so typos make near-duplicate tags. Typing two tags quickly can lose the first, because
each save sends the whole tag list from a copy that may be stale.

The numbers a card shows are a row of chips whose number and order change from Channel to
Channel, so a row of cards cannot be compared by eye. Bios differ in length and push everything
below them to a different height on each card.

There is no keyboard path through the grid, although the Posts tab has one. A Channel's photo
cannot be enlarged. A tile's name appears in the browser's native tooltip after about a second.
"Sync all" starts syncing every eligible Channel on one click, with no confirmation and no way to
stop it once it runs.

## Solution

Every card size is redrawn, and the two larger ones become a grid of numbers that lines up across
each row.

A **tile** stays the photo alone. Its name and handle appear in the app's own tooltip after half a
second. On hover it shows a magnifier at the photo's bottom left, which opens the photo full
screen, and an "Open in Telegram" link at the photo's bottom right.

A **compact card** gains its Last sync, written as an age ("3h ago") and coloured by whether the
Channel is on schedule, with the next sync under it.

A **card** keeps today's header: photo, title and handle, with the Language, sort rank and partial
history badges at the top left. The bio is cut at two lines with a More/Less toggle. Below it is a
grid of stat tiles, each a big number over a small label: Posts, In scope, Reach and Per hour,
plus Subscribers and the media counters when the Account's card settings show them. Then the
tags, as a field that is always there to type into, completing from the Account's other tags. The
footer says Restricted or Frozen when either is true, the Last sync as "Synced 3h ago" in the same
colour, the next sync, the Start ID and the Sync button. Header, bio, tiles, tags and footer each
start at the same height as the same section on the neighbouring cards in the row.

A **detailed card** shows every tile whatever the settings, cuts the bio at about four lines with
More, adds a line with the Channel's chat id, when it was followed and which Channel it was
auto-followed from, and lists the Regular and the Dynamic schedule on a line each.

Clicking a photo opens it full screen in the viewer the Posts tab uses, and the arrows step
through every Channel photo loaded on the page. A **keyboard mode**, like the Posts tab's, moves a
highlight through the grid with `j` and `k`, jumps with `gg` and `G`, and fires the highlighted
card's actions with one letter each. **Sync all** asks first, saying how many Channels it will
sync and how many it skips, and while it runs the button becomes **Stop sync**.

## User Stories

1. As an Account, I want a compact card to show its Channel's Last sync as an age, so that I can spot a stale Channel without switching to a bigger card size.
2. As an Account, I want the Last sync coloured green when nothing is due, so that a healthy Channel reads as healthy at a glance.
3. As an Account, I want the Last sync coloured amber when a schedule is past its next sync time by less than a day, so that a slightly late Channel stands out without alarming me.
4. As an Account, I want the Last sync coloured red when a schedule is late by a day or more, or when the Channel has never synced, so that a Channel that is really stuck is impossible to miss.
5. As an Account, I want the Last sync grey when both schedules are off or the Channel is Frozen, so that a Channel nothing is expected of never reads as late.
6. As an Account, I want a weekly-synced Channel to stay green for the whole week, so that the colour tells me about the schedule rather than a fixed age.
7. As an Account, I want a compact card to show its next sync under the Last sync, so that I know when it will refresh.
8. As an Account, I want the exact Last sync time and both schedules in a hover hint, so that I can check precise times without opening anything.
9. As an Account, I want the footer's status to say only Restricted or Frozen, so that it never claims a Channel is pending when it synced a minute ago.
10. As an Account, I want "Synced 3h ago" in the footer instead of a status word, so that the footer says something that is true after a reload.
11. As an Account, I want the Last sync shown once on a card, so that the card does not repeat itself in a body chip and the footer.
12. As an Account, I want a detailed card to list the Regular and the Dynamic schedule on separate lines, so that I know which schedule runs next and when.
13. As an Account, I want a schedule whose time has passed to read "due" in amber, so that I can tell a late run from an upcoming one.
14. As an Account, I want a schedule that is switched off to read "off", even if an old time is still stored, so that the card never promises a run that will not happen.
15. As an Account, I want a schedule that is on but has no time yet to read "not scheduled", so that I can tell it apart from one that is off.
16. As an Account, I want a card's numbers as a grid of tiles with a big number over a small label, so that I can compare a row of Channels by eye.
17. As an Account, I want Posts, In scope, Reach and Per hour on every card, so that the numbers I look at most are always in the same place.
18. As an Account, I want Subscribers and the media counters on a card to follow my card settings, so that I keep control of how busy a card is.
19. As an Account, I want a detailed card to show every tile whatever my settings, so that the detailed size always shows everything.
20. As an Account, I want a tile my settings turn on to appear on every card, as a dash when the Channel has no value, so that every card in the grid has the same tiles in the same places.
21. As an Account, I want an In scope tile showing how many of the Channel's Posts are in the current Scope, so that I can see what an operation would read from it.
22. As an Account, I want In scope to read as a dash with a "not selected" hint for a Channel outside the Scope's selected Channels, so that I do not mistake "not in the Scope" for "nothing matched".
23. As an Account, I want Reach shown with a tilde when it is an estimate, and as a dash when it is not measured, so that the tile never overstates what is known.
24. As an Account, I want every number's exact value in a hover hint, so that a rounded "1.24K" can be checked.
25. As an Account, I want each card's header, bio, tiles, tags and footer to start level with the same section on the cards beside it, so that I can scan a row without my eye jumping.
26. As an Account, I want a card's bio cut at two lines with a More/Less toggle that only appears when there is more, so that long bios do not swamp the grid.
27. As an Account, I want a detailed card's bio cut at about four lines with More, so that one long bio does not stretch a whole row.
28. As an Account, I want the toggle to appear exactly when text is hidden, including after the column count changes, so that it never offers More on a bio that already fits.
29. As an Account, I want the Language, sort rank and partial history badges where they are today, at the card's top left, so that the redesign does not move what I already know where to find.
30. As an Account, I want the card's photo, title and handle at today's size, so that the header stays as readable as it is.
31. As an Account, I want the tag field always present after a card's tags, so that I can start typing a tag without clicking a button first.
32. As an Account, I want the tag field to suggest my existing tags as I type, so that I reuse a tag instead of creating a near-duplicate.
33. As an Account, I want suggestions ranked first by how often a tag appears alongside this Channel's tags, then by how many Channels carry it, so that the likeliest tag is on top.
34. As an Account, I want Tab to take the top suggestion, so that completing a tag costs one key.
35. As an Account, I want Enter to add exactly what I typed unless I picked a suggestion with the arrow keys, so that a new tag that starts like an old one can still be created.
36. As an Account, I want a comma to add the tag and leave the field ready for the next, so that I can type several tags in a row.
37. As an Account, I want Backspace in an empty field to remove the Channel's last tag, so that I can undo a tag without reaching for the mouse.
38. As an Account, I want Escape to leave the field, so that I can get out without adding anything.
39. As an Account, I want tags typed in quick succession all kept, so that typing fast never loses a tag.
40. As an Account, I want a tag starting with "group:" refused with a message, so that I cannot collide with a Setting group's virtual tag.
41. As an Account, I want clicking a tag's name to filter the grid to Channels carrying that tag, so that I can jump from one Channel to its peers.
42. As an Account, I want an AI-assigned tag marked as such, as today, so that I can tell my tags from a Tag run's.
43. As an Account, I want to click a Channel's photo on a card or a compact card to see it full screen, so that I can look at a logo that is too small to read.
44. As an Account, I want a magnifier at the bottom left of a tile's photo on hover to open the photo, so that a tile can still be selected by clicking it.
45. As an Account, I want the viewer's arrows to step through every Channel photo loaded on the page, in grid order, so that I can flip through Channels by their photos.
46. As an Account, I want closing the viewer to leave the grid at the Channel whose photo I viewed last, so that I do not lose my place.
47. As an Account, I want the avatars in the Posts tab's post headers kept out of the Posts tab's photo gallery, so that browsing Post photos is unchanged.
48. As an Account, I want "Open in Telegram" at the bottom right of a Channel's photo at every card size, so that it is always in the same place.
49. As an Account, I want a tile's name and handle in the app's tooltip after half a second, so that a wall of tiles is quick to read and looks like the rest of the app.
50. As an Account, I want a Keyboard switch on the Channels tab, as on the Posts tab, so that I can work through Channels without the mouse.
51. As an Account, I want the Keyboard switch to last for the browser session, so that it resets the way the Posts tab's does.
52. As an Account, I want `j` and `k` to move the highlight to the next and previous Channel in reading order, so that the keys work the same as on the Posts tab.
53. As an Account, I want the first `j` or `k` to start at the first row on screen, so that the highlight starts where I am looking.
54. As an Account, I want `gg` to jump to the first Channel and `G` to the last loaded one, so that I can cross a long grid in one move.
55. As an Account, I want the highlighted card scrolled to the middle of the screen, so that the bars above the grid never cover it.
56. As an Account, I want `x` to select or deselect the highlighted Channel, so that I can build a selection from the keyboard.
57. As an Account, I want `s` to sync the highlighted Channel, so that I can refresh one Channel without the mouse.
58. As an Account, I want `t` to put me in the highlighted card's tag field, so that tagging needs no mouse.
59. As an Account, I want `f` to freeze or unfreeze the highlighted Channel, so that I can park a noisy Channel quickly.
60. As an Account, I want `o` to open the highlighted Channel in Telegram at every card size, so that the key never depends on the size.
61. As an Account, I want `b` to expand or collapse the highlighted card's bio, so that I can read a long bio without the mouse.
62. As an Account, I want `p` to open the highlighted Channel's photo at every card size, so that the viewer is a key away.
63. As an Account, I want Escape to drop the highlight, so that I can leave keyboard mode's selection without turning it off.
64. As an Account, I want keys pressed while I type in a field, or while a dialog is open, ignored by keyboard mode, so that typing a tag or browsing photos never moves the highlight.
65. As an Account, I want the key legend to list only the keys that work at the current card size, so that a key the legend offers never does nothing.
66. As an Account, I want no key for Reset or Remove, so that a slip of the finger cannot destroy a Channel's Posts or my Follow.
67. As an Account, I want `gg` and `G` on the Posts tab as well, so that both tabs share one set of keys.
68. As an Account, I want Sync all to ask before it starts, saying how many Channels it will sync and how many it skips as frozen or excluded, so that I do not start a long sync by accident.
69. As an Account, I want the command palette's Sync All to ask the same question, so that the palette cannot skip the confirmation.
70. As an Account, I want Sync all to become Stop sync while it runs, so that I can stop a sync I started by mistake.
71. As an Account, I want Sync selected to offer Stop sync the same way, so that a large selected sync can be stopped too.
72. As an Account, I want stopping to cancel the Channels still waiting as well as the one syncing, and keep what was already synced, so that stopping is safe.
73. As an Account, I want a message saying the sync stopped, so that I know the click worked.
74. As an Account, I want a single Channel's Sync button to keep working as today, so that the common case does not change.

## Implementation Decisions

- **The redesign replaces today's card for everyone.** There is no setting to keep the old card,
  and the prototype's variant switch, its context and its search parameter go away.
- **The card face stays the one tested module that draws every size.** The face that renders
  compact cards, cards and detailed cards, and the tile, keep taking everything as props, as the
  existing face does. Anything the prototype read from app state inside a card (tag suggestions,
  the Channel filter setter used by clicking a tag, whether the Channel is in the Scope's selected
  Channels) is passed in instead, so a card renders in a test with no router and no data context.
- **What each size shows is decided in one place.** The existing description of a card size
  gains what this spec adds: whether the size is detailed, which stat tiles it shows, and which
  keyboard actions it supports. The key legend reads the last of those, so it cannot drift from
  what the cards actually carry.
- **Stat tiles are facts with a fixed slot list.** A fact is a key, a label, a display value and an
  exact hint. Posts, In scope, Reach and Per hour always appear; Subscribers and the four media
  counters (photos, videos, files, links) appear when the size is detailed or the Account's card
  settings show them. A slot that is shown always renders; a Channel with no value shows a dash.
  Counter values use the existing compact count format, so "1.24K" matches the rest of the app.
  Reach keeps today's rules: a tilde when estimated, "not measured" in the hint when absent.
- **In scope is a dash outside the Scope.** A Channel not among the Scope's selected Channels (the
  Hidden selection counts as selected) shows a dash with the hint "not selected"; a selected one
  shows its in-scope count from the shared counts query the card reads today, including zero.
- **Rows line up with CSS subgrid.** Each card spans one track per section of its grid row (header,
  bio, tiles, tags, the detailed card's About line, footer) and shares them as a subgrid, so the
  tallest bio in a row sets that row's bio track. A section a card does not have is an empty
  track, never a missing one. The grid row's own row gap is overridden on the card, so the card
  keeps its internal spacing. Tiles and compact cards do not use this.
- **The status label shows only states that are always true.** Restricted and Frozen remain;
  "Up to date" and "Pending" are removed from card faces, because the newest post id they compare
  against exists only in the browser tab. The syncing overlay's progress percentage keeps using
  that value while a sync this tab watches is running.
- **The Last sync colour is computed against the schedules, by one pure function.** Its inputs are
  the Channel's Last sync, whether each schedule is on, each schedule's next sync time, whether
  the Channel is Frozen or Restricted, and now. Its output is one of on-schedule, due, late,
  never, or idle. The rule:
  - idle (grey) when the Channel is Frozen, or both schedules are off;
  - never (red) when there is no Last sync;
  - late (red) when an enabled schedule's next sync time is 24 hours or more in the past;
  - due (amber) when an enabled schedule's next sync time is in the past by less than 24 hours;
  - on-schedule (green) otherwise.
  A Restricted Channel keeps its red Restricted label and shows its age in grey. The card exposes
  the result as a data attribute, which the tests read instead of colour classes. The prototype
  used fixed 1-day and 7-day thresholds instead; that rule is superseded.
- **Each schedule has one of four states.** This shape came from the prototype and is the decision:

  ```ts
  type Slot = {
    label: "Regular" | "Dynamic"
    state: "off" | "unscheduled" | "due" | "upcoming"
    at: number | null // the next sync time; null when off or unscheduled
  }
  // off:         the schedule is disabled, whatever time is stored
  // unscheduled: enabled with no next time
  // due:         the next time has passed
  // upcoming:    the next time is in the future
  // Regular defaults to on and Dynamic to off when the Channel says nothing.
  ```

  A detailed card lists both slots, "in 3h", "due, 2h ago", "not scheduled" or "off". A card and
  a compact card show the earliest enabled slot as "next in 40m".
- **The body's Last sync chip is removed.** The footer is the one place a card shows it.
- **The tag field is a token field.** Chips, then an always-present field. Suggestions are the
  Account's tags this Channel lacks, excluding Setting groups' virtual tags, ranked by how many of
  the Channels sharing a tag with this one carry the tag, then by how many Channels carry it, then
  alphabetically; matching puts prefix matches before substring matches. Tab takes the highlighted
  suggestion or the top one; Enter adds the arrow-chosen suggestion, else what was typed (matched
  case-insensitively to an existing tag); a trailing comma commits; Backspace in an empty field
  removes the last tag; Escape blurs. The suggestion list is a popover anchored to the field, so a
  card's clipped edges never hide it. Suggestions are computed only while the field has focus.
  The bulk bar's tag fields keep their own ranking by how many Channels carry a tag.
- **Tag saves are serialised per Channel in the browser.** The card keeps an optimistic copy of the
  tag list, and each save waits for the previous one to finish before sending the list it then
  holds. No backend change.
- **Clicking a tag's name adds a tag funnel to the Channel filter**, the same edit the facet menu
  makes, through the Channel filter's existing text form in the URL.
- **The bio has two lengths.** Cards cut it at two lines and detailed cards at about four, each
  with a More/Less toggle shown only when the text overflows. Overflow is measured from the
  rendered text and measured again when the card's width changes.
- **The photo viewer is the Posts tab's viewer, unchanged in behaviour.** A Channel photo joins the
  viewer's gallery only when the card asks it to, so post-header avatars never do. The viewer
  scrolls back to the Channel or Post of the last photo viewed, finding whichever kind of card
  holds it. Its accessible title says "Channel photo" for a Channel. On cards and compact cards the
  photo itself is the button, raised above a compact card's selection layer; on tiles a hover
  magnifier at the photo's bottom left is the button, and the tile's selection becomes an overlay
  so the magnifier can sit beside it.
- **"Open in Telegram" sits at the photo's bottom right at every size**, shown on hover and on
  keyboard focus, as cards show it today.
- **The tile tooltip is the app's tooltip component**, whose delay is set app-wide at 500 ms.
- **Keyboard mode follows the Posts tab's pattern.** A session switch next to the card-size switch
  turns it on, and the key legend in the corner is shared with the Posts tab. Moving is a pure
  function of the current index, the move and the count: `j` and `k` step one Channel in reading
  order, `G` goes to the last loaded Channel and `gg` (two presses within 600 ms) to the first;
  nothing moves past either end. Because the grid unmounts cards scrolled out of range, the
  highlight is held as a Channel name in state and rendered by the card, and moving scrolls the
  grid's virtualiser to centre the row. An action letter clicks or focuses the control in the
  highlighted card that carries that letter, so every action keeps one implementation, its
  control's. Keys are ignored with a modifier held, while a field has focus, or while a dialog is
  open, as on the Posts tab. The letters: `x` select, `s` sync, `t` tag field, `f` freeze, `o`
  open in Telegram, `b` bio, `p` photo, Escape drops the highlight. Tiles and compact cards
  support `x`, `s`, `o` and `p`; cards and detailed cards support all seven.
- **The session-flag hook and the key legend become shared code** used by both tabs.
- **The Posts tab's keyboard mode gains `gg` and `G`.**
- **Sync all asks first, on the button and in the command palette.** One function counts what Sync
  All would send (the same eligibility rule the sync uses) and how many it skips, and both
  confirmations show its text. The command palette marks Sync All as needing confirmation through
  its existing mechanism.
- **Stop sync replaces Sync all, and Sync selected's button, while their job runs.** The sync hook
  keeps the running job's id from the moment the job starts until it settles, for Sync All and for
  Sync selected, and exposes a stop action that calls the existing cancel endpoint and confirms
  with a message. The endpoint already cancels queued Channels and the one in progress, across the
  API and worker processes. A single Channel's sync has no stop.

## Testing Decisions

- A good test drives what an Account sees and does: render a card or press keys, then read the
  text, roles, accessible names and data attributes. It does not inspect component state, call
  internal helpers through private exports, or assert on colour class names.
- **Seam 1, the card face rendered from props**, carries most tests. Prior art is the existing card
  test file, which already renders the face and the tile at each size with no app context. It
  covers, per size: which tiles appear and in what order, the dash slots, In scope for a selected
  and an unselected Channel, Reach estimated and unmeasured, the status label (only Restricted or
  Frozen), the Last sync state attribute for each of the five states, the schedule lines for each
  slot state, the bio toggles at both lengths, the tag field's keys and suggestion order, the
  "group:" refusal, the save serialisation (two quick adds both reach the save callback in order,
  the second carrying both tags), the photo and Telegram controls and their positions, and which
  keyboard letters each size carries.
- The Last sync rule and the slot states are pure, but they are tested through the face, through
  its data attribute and text, unless a case cannot be reached that way.
- **Seam 2, one Playwright spec on the Channels tab**, added to the existing Channels end-to-end
  spec and run against the end-to-end backend like the rest of it. It covers what needs a real
  browser: sections lining up across a row (compared by element positions), keyboard mode end to
  end (`j`, `gg`, `x`, `o`, and the legend changing with the card size), Sync All's confirmation
  followed by Stop ending the job as cancelled, and the photo viewer stepping through Channel
  photos. Prior art is that spec and the UI primitives spec that already clicks Sync All.
- **Existing seams extended:** the sync hook's test with spies on the API object (prior art: the
  hook test the prototype added) for Stop on Sync All and on Sync selected; the command
  definitions' test for Sync All requiring confirmation; the Posts tab keyboard test for `gg` and
  `G`; the pure keyboard-move test for `j`, `k`, `gg` and `G` at both ends.
- Every new branching component gets a unit test, so the frontend CRAP ratchet stays green.
- The Playwright mocks and end-to-end specs that click Sync All are updated to confirm first.
- Every new guard or test is mutation-checked: break the behaviour it covers and watch it fail.

## Out of Scope

- Any backend change. Everything here reads fields the Channel list already sends.
- Showing Stop sync after a page reload. That needs an endpoint reporting the Account's running
  Sync All or Sync selected job, and there is deliberately no list of sync jobs today. The sync
  keeps running unattended, which is harmless.
- Stopping a single Channel's sync.
- An endpoint that adds or removes one tag, instead of replacing the list.
- Changing the bulk bar's tag suggestion ranking.
- Making the syncing overlay's progress percentage survive a reload.
- Colouring the Last sync by each schedule's interval rather than a fixed 24-hour lateness line.
- Keys for Reset and Remove.

## Further Notes

- The prototype is the reference for look and spacing, not code to copy: it was written behind a
  variant switch, with prototype shortcuts noted in its comments, such as whole-list tag saves that
  could arrive out of order.
- Variant 0 in the prototype is `main` as it was on 2026-10-08, kept for comparison.
- The first-sync behaviour, Follows and Setting groups are untouched; the Frozen state comes from
  the Channel's Setting group as today.
