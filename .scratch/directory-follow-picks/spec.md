# Directory: Ticks on every row, Tags, keyboard and a phone layout

Status: ready-for-agent

Ticket prefix: `DFP`.

Settled by a UI prototype on live staging data and four rounds of decisions (2026-10-12). Six
variants were tried on branch `prototype/directory-follow-picks` (a sanitized snapshot is
pushed); the chosen one is **F**, and its README in `.scratch/directory-follow-picks/` lists what
it does and how to run it. The terms **Tag**, **Seed** and **Tick** are in `CONTEXT.md`;
**Shared parent** and **Shared child** now speak of Seeds. **ADR-029** records that Tags belong
to the Account, not the Follow; read it, and ADR-027 and ADR-028, before changing the Directory
reads. This spec uses **Seed** only as the glossary's noun; the backend's existing "seeding the
Directory" (populating it at launch) is unrelated.

## Problem Statement

An Account that wants to find Channels related to the ones it already follows cannot say "these
few of my follows" in the Directory. A followed row has no tick, so the Shared parents and Shared
children Conditions can compare with every Follow, the Channels tab's selection, typed handles or
ticked unfollowed Channels, but never with a hand-picked handful of follows. Cited by and Cites
stop at 50 typed handles.

A group of Channels the Account cares about has no name anywhere it can reuse. Tags would be the
natural name, but a Tag lives on a Follow: it cannot sit on a Channel the Account has not
followed, and unfollowing deletes it.

Working through the Directory is slow by hand: every row is a mouse trip, the detail panel has to
be opened per row, and "Why it's here" can run to a long list of citing Posts. On a phone the
filter bar fills the whole first screen before a single row appears, the search box is squeezed to
a few characters, and the tick boxes are too small to hit.

## Solution

Every Directory row can be ticked, followed or not, so any mix of Channels can be the Seeds of a
Shared or Cited Condition. The bulk bar's Follow and Dismiss act on the unfollowed Ticks only and
say so.

Tags move to the Account: a Tag can sit on any Channel, followed or not, and survives an unfollow.
In the Directory the Account tags its Ticks from the bulk bar or one Channel from its panel, sees
each row's Tags, filters by a Tag ("In the Tag news", negatable), and uses a Tag as the Seeds of a
Shared, Cited by or Cites Condition. The server resolves the Tag, so a Tag of any size costs one
short word in the link. Tags can be renamed and deleted Account-wide.

A keyboard mode, like the Posts and Channels tabs', moves a highlight through the rows; Enter
opens the panel, which then follows the highlight as a reading pane. "Why it's here" shows three
citing Posts until asked for more. On a phone the controls fold into one sheet behind a button
beside the search, rows become two-line cards, the panel becomes a bottom sheet over the list, and
the bulk bar stays on one line. The search box's placeholder says what it searches.

## User Stories

Ticking every row

1. As an Account, I want to tick a Channel I already follow in the Directory, so that I can use a handful of my follows as Seeds.
2. As an Account, I want the header tick to tick every row on the page, followed or not, so that a whole page can become Seeds at once.
3. As an Account, I want a ticked followed row to look ticked like any other, so that I can see my Seeds at a glance.
4. As an Account, I want the bulk bar's Follow to act only on the unfollowed Ticks and say "Follow 3 of 5", so that I never re-follow a Channel by accident.
5. As an Account, I want the bulk bar's Dismiss to act only on the unfollowed Ticks too, so that I cannot dismiss a Channel I follow.
6. As an Account, I want the bulk bar to say the Ticks are all followed, and offer no Follow or Dismiss, when every Tick is a follow, so that the bar never offers a button that would do nothing.
7. As an Account, I want my Ticks to stay ticked after a Follow finishes, so that the Channels I just followed are still my Seeds.
8. As an Account, I want "Channels ticked here" in a Shared Condition to include ticked follows, so that comparing with my Ticks means all of them.
9. As an Account, I want Cited by and Cites to accept up to 500 fixed handles, so that a large typed or copied list is not cut at 50.
10. As an Account, I want Cited by and Cites to fill their handles from my Ticks, my Channels tab selection, every Follow or a Tag, so that I do not retype handles I already marked.

Tags

11. As an Account, I want to put a Tag on a Channel I do not follow, so that I can name groups of Channels while exploring the Directory.
12. As an Account, I want to tag every Ticked Channel from the bulk bar, choosing an existing Tag or typing a new one, so that building a group is one action.
13. As an Account, I want to remove a Tag from every Ticked Channel, so that I can correct a group in one action.
14. As an Account, I want to add and remove a Channel's Tags in its detail panel, so that I can tag the one Channel I am reading, which is how I work on a phone.
15. As an Account, I want each Directory row and card to show its Tags, so that I can see which groups a Channel is in without opening it.
16. As an Account, I want to tick exactly a Tag's Channels from the Tags menu, so that I can look at a group and act on it.
17. As an Account, I want to rename a Tag everywhere it is used, so that a group's name can change without retagging every Channel.
18. As an Account, I want to delete a Tag from every Channel after a confirmation stating how many Channels it is on, so that I can drop a group I no longer need without surprise.
19. As an Account, I want unfollowing a Channel to keep its Tags, so that what I said about a Channel survives my stopping watching it.
20. As an Account, I want following a Channel again to show the Tags it had, so that refollowing loses nothing.
21. As an Account, I want the Channels tab to show and edit Tags exactly as it does today, so that the move changes nothing I already use.
22. As an Account, I want "News" and "news" to be one Tag, so that case never splits a group.
23. As an Account, I want a Setting group's `group:` Tags to work in the Directory like any other Tag, so that a Tag is a Tag wherever I use it.
24. As an Account, I want no limit on how many Tags I keep or how many Channels one Tag holds, so that I never hit a wall while organizing.
25. As an Account, I want my Tags on unfollowed Channels to travel in my account export and come back on import, so that moving deployments keeps my groups.

Filtering and comparing by Tag

26. As an Account, I want "In the Tag news" as a Condition of the Directory filter, so that I can list a group's Channels with every other filter applied.
27. As an Account, I want to negate it ("not in the Tag news"), so that I can find Channels that are not yet in a group.
28. As an Account, I want a Tag to be a source of Seeds for Shared parents and Shared children, so that I can find Channels read by the same people as a group I built.
29. As an Account, I want a Tag-sourced Condition to follow the Tag as I change it, so that adding a Channel to the Tag widens the comparison without editing the filter.
30. As an Account, I want a Tag to be a live source for Cited by and Cites, with no handle limit, so that a group of thousands still works.
31. As an Account, I want a link with `tag:"news"` to stay short however many Channels the Tag holds, so that I can share and reload the view.
32. As an Account, I want a link I send someone else to resolve against their own Tags, so that "news" means their news, never mine.
33. As an Account, I want a Condition naming a Tag I no longer have to stay in the filter, struck through and matching nothing, so that a renamed or deleted Tag never silently widens my results.
34. As an Owner in View-as, I want to see the target Account's Tags in the Directory, so that I see what they see.
35. As an Owner in View-as, I want tagging to need elevation like every other write, so that viewing never changes the target's Tags.

Keyboard

36. As an Account, I want a Keyboard switch on the Directory, kept for the browser session like the Posts and Channels tabs', so that I can browse without the mouse.
37. As an Account, I want j and k to move a highlight through the rows and gg and G to jump to the first and last, so that the keys match the other tabs.
38. As an Account, I want ] and [ to turn the page and land the highlight on the new page's first row, so that a long result is walkable.
39. As an Account, I want x, f, d, o and t to tick, follow, dismiss, open in Telegram and tag the highlighted row, so that every row action has a key.
40. As an Account, I want Enter to open the detail panel and, while it is open, the panel to follow the highlight, so that I can read Channels one after another.
41. As an Account, I want Enter to close the panel again, after which j and k move only the highlight, so that I choose when the panel follows.
42. As an Account, I want Esc to drop the highlight, so that I can leave keyboard mode's state at once.
43. As an Account, I want a legend of the keys while keyboard mode is on, so that I do not have to remember them.

Reading a Channel

44. As an Account, I want "Why it's here" to show the first three citing Posts until I ask for more, so that the panel stays readable when many Posts cite a Channel.
45. As an Account, I want the expansion to reset when I open another Channel, so that every Channel starts compact.

Phone

46. As an Account on a phone, I want the filter controls behind one button beside the search box, showing how many Conditions are on, so that the first screen shows rows, not controls.
47. As an Account on a phone, I want that button to open a full-screen sheet with every control, including where the search looks, and a Done button, so that nothing is lost by folding it away.
48. As an Account on a phone, I want the search box to keep the full width, so that I can read what I type.
49. As an Account on a phone, I want each row as a two-line card with a large tick, the name, the handle, its Tags and its key numbers, so that rows are easy to read and to hit.
50. As an Account on a phone, I want the detail panel to open as a bottom sheet over the list, so that I can tap another card and the sheet switches to it.
51. As an Account on a phone, I want the bulk bar on one line that scrolls sideways, so that it does not push the list down.
52. As an Account on a phone, I want the Keyboard switch hidden, so that the screen carries no control I cannot use.
53. As an Account on a wide screen, I want the table, bar and side panel exactly as they are, so that the phone layout costs the desktop nothing.

Search

54. As an Account, I want the search box's placeholder to say what it searches ("Search names and bios"), so that I can see the Name, Bio and Posts switches' effect before typing.

## Implementation Decisions

Tags (ADR-029)

- **Tags leave the Follow.** A new per-Account table holds one row per Account, Channel and Tag: the Account, the Channel's normalized handle (lowercase, the same key the Directory, the dismissals and the References use, never the Channel id, whose case differs), the Tag's name as first written, its source (manual or AI) and when it was assigned. Uniqueness is on the Account, the handle and the lowercased name. The Follow's tags column is dropped once the move lands; `test_superseded_columns.py` then guards it.
- **A migration moves every Follow's Tags** into the new table, keeping source and assigned time, and reconciles case-duplicates the way the setting-group backfill did. Its test runs the migration's own statement, as `test_directory_seed.py` and `test_owner_backfill.py` do.
- **One aggregate owns the Tag rows**, the sole writer, with its own kind entry in the service-kind inventory. The Follow's sole writer stops writing Tags. Unfollowing does not touch Tag rows.
- **The tenancy seam classifies the table as user-owned.** Reads go through the seam; by-id writes refuse a foreign row in both flag states, like every other user-owned table. The account-isolation probes, the export inventory (a Tags section, Tags on unfollowed Channels included) and the import write-scoping inventory all list it.
- **Every existing Tag path keeps its wire shape**: the Channels list still carries each Channel's Tags, the bulk Tag route and Tag runs still write them, the Channel filter still tests them. The Tag-run applier writes through the new aggregate and still only tags followed Channels in its Scope.
- **Group Tags stay derived.** A `group:` name is reserved and never stored; it resolves to the Account's followed Channels in that Setting group, in the Directory as on the Channels tab.
- **New Tag routes** for the Directory: tag or untag a list of handles with one Tag; list the Account's Tags with their Channel counts; rename a Tag Account-wide (a rename onto an existing name merges); delete a Tag Account-wide. Each declares a response model, lives in the data package, and is approval-gated and View-as-refused like every write. Merging on rename and the confirmation count on delete are the route's to answer.
- **No limits** on Tags per Account or Channels per Tag; no Settings value is added. Tag names keep today's rules: trimmed, compared case-insensitively, shown as first written, no length cap, spaces allowed (the text form quotes them).

The Directory filter

- **A `tag` Condition.** Its wire form names the Tag; the server resolves it against the caller's Tags (or the target's under View-as) inside the read, the same way the followed and dismissed flags resolve the caller's rows. A Tag the caller does not have matches nothing. Its text form is `tag:"news"`; negation is the filter's ordinary NOT.
- **A Tag as Seeds.** The Shared Condition carries either resolved handles, as now, or a Tag name the server resolves; Cited by and Cites do the same. Ticks, the Channels tab selection, every Follow and typed handles are still resolved by the browser and sent as handles.
- **Fixed handle caps.** Cited by and Cites accept up to 500 handles (from 50); the Shared cap stays 10,000. 500 handles keeps a shared link under the 8 KB request lines common proxies accept; anything larger is a Tag.
- **The code says Seed.** The Shared Condition's `picks` (wire, text form and frontend types) is renamed to Seeds; the text-form words for the browser-side sources stay readable (`parents:ticked`, `parents:follows`, `parents:tag:news`). A link written with the old word still parses.

The shapes the prototype settled on, with its pick sets renamed to Tags:

```ts
// From prototype F, renamed: a Condition's Seeds come from exactly one source.
type SeedSource =
  | { kind: "ticked" }      // the Directory's Ticks, live
  | { kind: "selection" }   // the Channels tab selection, live
  | { kind: "follows" }     // every Follow, live
  | { kind: "tag"; name: string } // resolved on the server, live
  | { kind: "handles"; handles: string[] } // typed or copied, fixed

type DirectoryCond =
  | /* the existing Conditions */
  | { type: "tag"; name: string } // "In the Tag news"; NOT negates it
```

The Directory tab

- **Ticks on every row.** The row and header ticks no longer lock followed rows. The bulk bar computes its actionable handles as the Ticks minus the Account's follows, matched case-insensitively against the follow list as well as the current page, and labels "N of M" when they differ. Ticks survive a Follow job.
- **Tags in the tab.** The bulk bar and the area above it carry a Tags control: tag or untag the Ticks, tick a Tag's Channels, rename, delete. Rows, cards and the panel show the Channel's Tags; the panel adds and removes them. All Tag state is server state through TanStack Query; nothing is kept in browser storage.
- **Keyboard mode** follows the Posts feed and Channels grid: a session switch, the shared move reader, a highlight attribute on the row, and letters that press the row's control carrying the matching shortcut, so each action keeps one implementation. Enter toggles the panel; while open the panel follows every move and every page turn; Esc drops the highlight and closes the panel. `t` opens the Tag picker for the highlighted row.
- **"Why it's here"** collapses to three citing Posts with "Show N more" / "Show fewer", the expansion belonging to the open handle, exactly as Recent posts does.
- **The phone layout** applies below the `md` breakpoint only. The bar's controls render inside a full-screen sheet (popovers open above it), the Name/Bio/Posts switches move into the sheet, rows render as cards while the table stays for `md` and up, the panel is a bottom sheet of about 55% of the screen with room left under the list, and the bulk bar is one sideways-scrolling line. The Keyboard switch is hidden there.
- **The placeholder** lists the enabled fields in their fixed order: "Search names", "Search names and bios", "Search names, bios and posts".
- **The generated client** is regenerated after the backend changes; the Directory's hand-written calls stay hand-written only where the client-split contract says so.

## Testing Decisions

- **A good test drives the outside**: an HTTP request and the rows it returns, or a user's clicks and keys and what the tab then shows. No test reaches into a hook's state, a query's SQL text or a component's internals.
- **Backend, through the Directory reads.** A filter tree with a `tag` Condition, its negation, a Tag as Shared Seeds and a Tag as Cited Seeds, each asserting which Directory entries come back, for two Accounts holding a Tag of the same name with different Channels. A deleted or unknown Tag matches nothing. Prior art: `test_directory_shared.py`, `test_directory_browse.py`.
- **Backend, through the Tag routes.** Tag and untag handles (followed and not), list with counts, rename (including onto an existing name), delete, a foreign Account's Tags untouched in both flag states, View-as refused without elevation. Prior art: `test_bulk_channel_tags.py`, `test_channel_tags.py`.
- **Backend, the move.** The migration's own statement carries every Follow's Tags across, case-duplicates merged, source and time kept; unfollowing afterwards leaves the Tag rows; the Channels list still returns each followed Channel's Tags. Prior art: `test_directory_seed.py`, `test_owner_backfill.py`, `test_unfollow.py`.
- **The guards each ticket will meet**: the tenancy classification and the byte-identical flag-off check, the account-isolation probes, the export inventory and the import write-scoping inventory, the service-kind inventory, the route inventory and the route-module hygiene, the View-as mutation inventory, the approval gate, the superseded-columns guard once the column drops, and the `tg_*` cleanup inventory. None is to be loosened; each new table and route is classified.
- **Frontend, the journey.** `tests/directory.spec.ts` over the mocked Directory API: tick a followed row and see "Follow 1 of 2"; keyboard j, x, Enter, j with the panel following; tag the Ticks and see the badge; add "In the Tag" and see the request name the Tag; a phone-sized viewport shows the filter button, cards and the bottom sheet. Mocks are updated wherever a response shape changes.
- **Frontend, the logic below it**: the keyboard hook (moves, page landing, Enter toggling, Esc), the bulk bar's actionable count, the placeholder text, and the filter's text form round-tripping `tag:"news"` and the Seed words, old and new. Prior art: `FeedKeyboard.test.tsx`, `DirectoryBulkBar.test.tsx`, the directory-filter tests. New branching components get a render test, as the CRAP ratchet requires.
- **Mutation-test each new guard and each new test** before trusting it, as the repo's guide asks.

## Out of Scope

- AI-tagging Directory entries: Tag runs keep tagging followed Channels in their Scope only, because tagging unfollowed Channels would spend the Account's AI Key on Channels it does not follow.
- Adding a Channel to a Tag from a Post or anywhere outside the Directory and the Channels tab.
- Swipe gestures on phone cards, triage auto-advance after an action, and a single "New to you" chip for the opening filter: proposed during the prototype, not chosen.
- The Directory read's 1-to-6-second latency, seen throughout the prototype; it deserves its own investigation.
- The app header's height on a phone, which every tab shares.
- Any change to the Channels tab beyond reading Tags from their new home.

## Further Notes

- The prototype's pick sets lived in browser storage and were expanded by the browser; both are replaced here (server-side Tags, server-side resolution). Its keyboard hook, card layout, sheet and placeholder are the reference for behaviour, not code to copy.
- The tickets are `issues/01` to `05` (DFP-01 to DFP-05), each landing on its own. DFP-03, the Tag
  move, can run beside DFP-01 and DFP-02; it must land before DFP-04, because a Tag on an
  unfollowed Channel needs somewhere to live.
- The prototype ran against staging through a read-only role and a local copy of this branch's Directory router; `docs/agents/prototyping-with-live-data.md` describes the setup.
