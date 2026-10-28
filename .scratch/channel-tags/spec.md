# Channel Tags: one Tags dropdown, ordered by Tag use; Setting groups apart; Last sync and Last post

Status: ready-for-agent

Ticket prefix: `TGU`.

Settled by a UI prototype and a grilling session on 2026-10-28. **ADR-042** records why Tags are
listed by Tag use, per tab, kept per Account, and what was tried and dropped; read it before
changing the order. The terms **Tag**, **Tag use**, **Setting group**, **Last sync**, **Last
post**, **Channel selection**, **Directory selection**, **Requests selection**, **Seed** and
**Condition** are in `GLOSSARY.md`; Tag use, Last post and the three selections are new for this
work, and **Directory selection** replaces the old **Tick**. **ADR-029** is where Account-owned
Tags come from.

The prototype is the pushed snapshot `prototype/channel-tags-usage` @ 1fcb1d7b, variant B. Its
README holds the verdict and how to run it. Its use and counts routes live in a standalone
prototype API against a scratch table, so its data layer is a sketch, not a model for the build;
its `FacetMenu` options (`manage`, `rowAction`, `selectAction`, `freezeOrder`) are close to what
the build needs.

## Problem Statement

An Account's Tags are listed by how many Channels carry each one. A few large Tags the Account
rarely reaches for (a bulk import's, a Tag run's) sit at the top of every list, and the small Tags
it filters by every day sit below them, so every visit starts with scrolling. The Channels tab,
the Directory and the Requests tab each show Tags, each differently: the Channels tab's dropdown
selects and filters but cannot rename or delete, the Directory's Tags menu renames and deletes but
cannot filter (the Filters menu can), and the Requests tab's Channels by Requests has no Tags at
all.

Setting groups pose as Tags. Outside the Channels tab a Setting group appears among the Tags as
`group:<name>`, a row that cannot be renamed or deleted, and the Directory filters and seeds by a
Setting group only through that pretence. Reaching a group's settings from the Channels tab means
leaving for Settings and finding it there.

The Sort and the Time filter offer "Last updated", which is the Last sync under a name the
glossary forbids. It is also wrong for a new Channel: creating a Channel on its first Follow
stamps it as synced before any sync has run. Nothing shows when a Channel last posted, so a dead
Channel looks the same as a busy one until someone opens it.

## Solution

One Tags dropdown on the Channels tab, the Directory and the Requests tab's Channels by Requests,
built on the Channels tab's facet dropdown. Each row reads: select, name, rename, delete, count,
filter. Selecting a Tag selects its Channels in that tab's own selection; filtering adds a Tag
Condition to that tab's filter. Delete asks first with the Tag's channel count; a rename onto
another Tag's name asks first because the merge cannot be undone.

Every list of Tags on a tab is ordered by that tab's Tag uses, kept on the server per Account,
so every device shows the same order. A list keeps its order while it is open and shows the new
order the next time it opens.

Setting groups leave the Tags dropdowns. The Directory and the Requests tab get the Channels tab's
Groups dropdown, and every Groups row on every tab has a gear that opens that Setting group in
Settings. In the Directory a Setting group is a Condition and a Seed source of its own.

"Last updated" becomes **Last sync** everywhere, and a Channel nobody has synced has none. **Last
post** is a Sort, a Time filter moment, a line on every Channel card, and a "No post in 30 days"
preset in the Filters menu. The three tabs all say select / selected / Select all.

## User Stories

### The Tags dropdown

1. As an Account, I want the same Tags dropdown on the Channels tab, the Directory and the
   Requests tab, so that I learn it once.
2. As an Account, I want every Tags row to read select, name, rename, delete, count, filter, so
   that selection is always leftmost and filtering always rightmost.
3. As an Account, I want selecting a Tag on the Channels tab to select its followed Channels in
   the Channel selection, so that it works as it does today.
4. As an Account, I want selecting a Tag in the Directory to add its Channels to the Directory
   selection, and unselecting it to remove them, so that I can act on a Tag's Channels in bulk.
5. As an Account, I want selecting a Tag on the Requests tab to put its rows back in the
   Requests selection, and unselecting it to take them out of every total, so that I can see what
   a Tag's Channels cost or set them aside.
6. As an Account, I want each Tags row to show how many of the tab's Channels carry it and how
   many of those are selected, so that I can tell at a glance what selecting it would do.
7. As an Account, I want the Directory's and the Requests tab's counts to come in one call when
   the dropdown opens, so that a Tag on 45,000 Channels does not stall the dropdown.
8. As an Account, I want a Tag none of the tab's Channels carry left out of that tab's dropdown,
   so that the Requests tab does not list Tags with no rows.
9. As an Account, I want filtering by a Tag in the Directory's Tags dropdown, as well as from the
   Filters menu, so that the quickest way in is one click.
10. As an Account, I want two filtered Tags in one dropdown to mean either one, so that the
    Directory and the Requests tab behave like the Channels tab.
11. As an Account, I want the dropdown's pill to name the filtered Tag, or how many, so that I
    can see the filter without opening it.
12. As an Account, I want to rename a Tag from its row on any of the three tabs, so that I do not
    have to go to the Directory to fix a typo.
13. As an Account, I want renaming a Tag onto another Tag's name to ask first, naming both Tags
    and their channel counts, so that I never merge two Tags by accident.
14. As an Account, I want a rename that changes only the letter case to go through without
    asking, so that fixing "bank" to "Bank" is one step.
15. As an Account, I want deleting a Tag to ask first with how many Channels it is on, followed or
    not, so that a misclick cannot strip a Tag from hundreds of Channels.
16. As an Account, I want derived rows (Untagged) to have no rename or delete, so that I am never
    offered something that cannot work.

### Order by Tag use

17. As an Account, I want each tab's Tags listed by my Tag uses on that tab, so that the Tags I
    reach for there come first.
18. As an Account, I want the order to fall back to channel count and then name, so that a new
    Account still sees a sensible list.
19. As an Account, I want recent Tag uses to count more than old ones, each halving every 14
    days, so that last month's project stops crowding the top.
20. As an Account, I want selecting or filtering by a Tag from anywhere on a tab (its dropdown,
    a card's Tag chip, the filter row's "In the Tag", a Tag as Seeds) to count as a Tag use, so that
    every way I use a Tag teaches the order.
21. As an Account, I want putting a Tag on Channels or taking it off by hand to count as a Tag
    use, so that the Tags I am building rise.
22. As an Account, I want a Tag run not to count, so that an AI run does not reshuffle my lists.
23. As an Account, I want every Tag list on a tab to share that tab's order: the dropdown, the
    bulk bar's Tag field, the filter row's Tag options, and in the Directory the Tag picker on a
    row, the panel and the bulk bar, and the Seeds' Tag choice, so that a Tag is in the same place
    in every menu on the tab.
24. As an Account, I want the order kept on the server, so that my phone and my desktop show the
    same order.
25. As an Account, I want a list to keep its order while it is open, so that the row I just
    clicked never moves under the pointer.
26. As an Account, I want a rename to carry a Tag's uses to its new name on every tab, so that
    fixing a typo does not drop it to the bottom.
27. As an Account, I want a Tag's uses to end when the Tag does (deleted, or untagged from its
    last Channel), so that a new Tag with an old name starts fresh.
28. As an Owner viewing as another Account, I want to see that Account's order and record no Tag
    use, so that looking around never reorders their lists.
29. As an Account, I want typing in any Tag list to filter it as it does today, so that the order
    never gets in the way of finding a Tag by name.

### Setting groups

30. As an Account, I want Setting groups out of the Tags dropdowns, so that every Tags row is a
    Tag I can rename or delete.
31. As an Account, I want a Groups dropdown in the Directory and on the Requests tab, like the
    Channels tab's, so that I can select and filter by Setting group there.
32. As an Account, I want a gear on every Groups row, left of its count, that opens that Setting
    group in Settings, so that I can change a group's sync settings from where I see its
    Channels.
33. As an Account, I want a Setting group to be a Condition in the Directory filter, matching only
    the entries I follow in it, so that "my Slow feed Channels" is a real filter, not a fake Tag.
34. As an Account, I want a Setting group to be a Seed source for Shared parents, Shared
    children, Cited by and Cites, so that I can compare the Directory with one group.
35. As an Account, I want an old link that says `tag:"group:<name>"` to keep working, read as the
    Setting group Condition, so that saved links survive.
36. As an Account, I want a Setting group Condition on the Requests tab's filter, so that I can
    see what one group's Channels cost.

### Last sync and Last post

37. As an Account, I want the Sort and the Time filter to say "Last sync", so that the label says
    what it measures.
38. As an Account, I want a Channel nobody has synced yet to have no Last sync, so that a
    brand-new Channel never looks freshly synced.
39. As an Account, I want a Last post Sort on the Channels tab, so that I can rank Channels by
    how recently they posted.
40. As an Account, I want Last post as a Time filter moment, so that I can filter by it like any
    other moment.
41. As an Account, I want every Channel card to show its Last post under its sync line, so that
    a dead Channel stands out without opening it.
42. As an Account, I want a "No post in 30 days" preset in the Filters menu, matching a Last post
    over 30 days ago or no Last post at all, so that I can find Channels worth unfollowing in one
    click.
43. As an Account, I want the Directory's last-Post moment and column called Last post too, so
    that one name means one thing in both tabs.

### Words

44. As an Account, I want every tab to say select, selected and Select all, so that I do not have
    to learn tick, pick and left out.
45. As an Account, I want the Requests tab to say how many Channels are unselected and offer
    Select all, so that taking rows out reads as the same act as everywhere else.

## Implementation Decisions

### Tag use

- **Storage.** Tag uses are a per-Account table owned by the Tags aggregate (the service that is
  already the sole writer of Account Tags owns it as its companion table): Account, tab, Tag key
  (the lowercased name, as Tags are keyed), and the moment of use. It is `USER_OWNED` in the
  tenancy seam. Recording keeps at most the 50 newest uses per Account, tab and Tag, which bounds
  the table without a retention job; older uses weigh under 0.1% by then. A new table needs its
  Alembic revision.
- **Score.** A Tag's score on a tab is the sum over its uses of `0.5 ^ (age / 14 days)`; ties go
  to the tab's channel count, then the name. The prototype computed it in SQL as
  `sum(power(0.5, (now - used_at)::float8 / half_life))`, and that is the shape to keep.
- **Tabs.** Exactly three: `channels`, `directory`, `requests`, a closed set the route validates.
- **What records a use.** Selecting or filtering by a Tag, its Channels as Seeds included, and
  putting it on or taking it off Channels by hand, from any control on the tab. A Tag run records
  none. The browser sends the use; recording is fire-and-forget and never blocks the act.
- **Rename and end.** Renaming a Tag moves its uses to the new key on every tab, inside the same
  write as the rename; a merge adds them to the target's. Deleting a Tag, or untagging its last
  Channel, deletes its uses in the same write, so a later Tag of the same name starts with none.
- **View-as.** Recording is a write and is refused in a View-as session by the existing rule;
  the browser does not send uses while viewing as someone. Reading the order is allowed, so the
  read joins the View-as read-only inventory if it is not a GET.

### Routes

- **One read per dropdown open, for the Directory and the Requests tab.** A route takes the tab,
  the scope (the handles the tab lists, or none for every Channel, as the Directory's) and the
  selected handles, and answers, per Tag the Account has: its channels in scope, how many of those
  are selected, its Tag use score on that tab and its last use. One statement. Setting groups are
  not in it. The prototype split this into a counts route and a uses route; the build folds them.
- **The Channels tab** keeps computing its counts from the followed Channels it already has, and
  reads only the Tag use scores for its tab (the same route with no counts needed, or a lighter
  read; the implementer picks, but it is one call).
- **Recording** is its own write route: tab and Tag name.
- **Each new route** joins the route inventories (`bash scripts/route-guards.sh`) and declares
  response models in the Tags schemas module.
- **Channel stats** gain `lastPostAt`: the newest of the Post timestamps the stats route already
  reads per Channel, so no extra query. `null` for a Channel with no stored Post. The prototype
  took it as the last of the oldest-first recent timestamps.

### The shared dropdown (frontend)

- **`FacetMenu`** gains: per-row rename and delete (icons that brighten on hover, a delete
  confirmation, a merge confirmation fed by a "would this rename merge?" check), a per-row action
  between the name and the count (the Groups gear), a selection action for a tab without ticks,
  and holding the row order from open to close. The prototype's names for these were `manage`,
  `rowAction`, `selectAction` and `freezeOrder`; the merge check was
  `mergeText(tags, from, to)`, answering only when the target exists and is not the same Tag by
  case.
- **Row order is the convention:** selection leftmost, then the name, then every other action,
  then the count, then the filter.
- **One Tags dropdown component** wraps `FacetMenu` for the Directory and the Requests tab, given
  the tab, the scope, the tab's selection and how to change it, and the tab's Tag Conditions. The
  Channels tab keeps its own wiring of `FacetMenu`, with the same row options.
- **Selecting a Tag needs its handles.** On a click, fetch that one Tag's handles (the existing
  Tag channels route) and add or remove them from the tab's selection. Nothing fetches every
  Tag's handles.
- **Every Tag list on a tab** reads the tab's order: on the Channels tab the dropdown, the bulk
  bar's Tag field and the filter row's Tag options; in the Directory the Tag picker (row, panel,
  bulk bar), the Filters' Tag options and the Seeds' Tag choice; on the Requests tab the dropdown
  and the filter row's Tag options.

### Setting groups

- **The `group:` Tags** stop appearing in any Tags list. The Tag list route may keep returning
  them for old callers, but no dropdown or picker shows them.
- **Groups dropdown** in the Directory and on the Requests tab, the same `FacetMenu` as the
  Channels tab's, with the gear. Selecting a group adds its followed Channels to the tab's
  selection.
- **The gear** navigates to Settings with `setting=sync.yours.settingGroups` and
  `settingGroup=<id>`, which already opens that group.
- **Directory filter:** a new Setting group Condition (by name in the URL form, as the Channel
  filter's), resolved on the server to the reader's Follows in that group. A Setting group is a
  Seed source too. The parser reads an old `tag:"group:<name>"` as the Setting group Condition.
- **Requests tab's channel filter** (client-side) gains a Setting group Condition and a Tag
  Condition; the Tag Condition matches a row when the Tag's handles include it, fetched per
  filtered Tag, and stands aside while loading.

### Last sync and Last post

- **Creating a Channel on its first Follow** no longer sets its Last sync. Its first regular sync
  is scheduled from the Follow's moment instead. A Channel with no Last sync sorts last and fails
  every Time bound on Last sync, as the Condition entry says.
- **Labels:** "Last sync" in the Sort and the Time filter, with the description "When its most
  recent sync finished." The card keeps "Synced 3h ago" / "Never synced".
- **Last post** on the Channels tab: a Sort option, a Time filter moment read from the channel
  stats, a line on every card size under the sync line, and a Presets section at the top of the
  Filters menu with "No post in 30 days": an OR of a Last post Time bound ending 30 days ago and
  Last post = none. The Directory's last-Post moment and column are labelled Last post.

### Words

- The three tabs say select / selected / Select all in their headers, bulk bars and counts:
  the Directory's "N ticked" becomes "N selected"; the Requests tab's "N Channels left out · Pick
  all" becomes "N Channels unselected · Select all". Code identifiers (`ticks`, `leftOut`) keep
  their names in this work.

## Testing Decisions

A good test drives the system through its outermost seam and asserts what a person or a caller
sees: a route's answer, a rendered row's text and order, a dialog's presence. It does not assert
which function was called or how a query is built. Two seams, chosen with the user:

- **The HTTP API, through the test client.** Tag uses: recording, the per-tab order, the 14-day
  decay (freeze the clock), the 50-use cap, a rename carrying uses (and a merge adding them), a
  delete and a last untag ending them, a Tag run recording none, recording refused in View-as and
  reading allowed, and the read route's counts against a scope and a selection, Setting groups
  left out. Account isolation: one Account never sees another's uses or counts. Channel stats:
  `lastPostAt` is the newest stored Post, `null` with none. Follow: a first Follow leaves the new
  Channel with no Last sync and still schedules its first sync. Directory filter: the Setting
  group Condition and Seed source, and an old `tag:"group:..."` link reading as one. Prior art:
  `test_directory_tags.py`, `test_tags_belong_to_the_account.py`,
  `test_channel_stats_endpoint.py`, `test_follows.py`, `test_directory_shared.py`,
  `test_view_as.py`, and the isolation probes in `test_account_isolation.py`.
- **The shared Tags dropdown, rendered with Testing Library.** Row order and its hold while open
  (a use while open moves nothing; reopening shows the new order); rename, the merge confirmation
  appearing only for another Tag's name and renaming only on confirm; delete confirming with the
  count; selecting calling the tab's selection change with the Tag's members; Untagged offering no
  rename or delete; the gear's position left of the count. Prior art: `FacetMenu.test.tsx`; the
  prototype's throwaway check of the merge flow is the shape.
- **Pure filter modules** get cases where a Condition is added: the Requests tab's channel
  filter (Tag and Setting group), the Directory filter's parse and print (Setting group, the old
  link), the Channel filter's Last post moment and the preset. Prior art: the existing tests
  beside each filter module, and `sort-channels-for-grid` for the Last post Sort.
- New guards are mutation-tested before trusting them (`scripts/mutate.py`), and a frontend
  guard's mutations go in `docs/agents/guard-mutations.json`.

## Out of Scope

- A "Recent" section over a stable list (proposed after the prototype, not chosen).
- Enter in a Tag search filtering by the top match, and an "any of" label on a pill with two
  filters.
- Renaming code identifiers (`ticks`, `leftOut`, the virtual `group:` Tag helpers) to the new
  glossary words.
- Clearing the Last sync of Channels already created with one before any sync; only new Channels
  change.
- The Posts tab, which has no Tags dropdown.
- Counting Tag runs as Tag uses, or a global order across tabs (ADR-042's considered options).

## Further Notes

- The prototype's scratch table on the deployment it ran against is the prototype's, not the
  build's; drop it when the prototype is torn down.
- Each Tags dropdown open in the Directory sends the Directory selection's handles; a large
  selection makes a large body. One call per open is the bound; if it shows in the edge log,
  send the selection's count only and fetch per-Tag selected counts lazily.
- The prototype measured the counts statement at 19 ms on staging's ~76,000 Tag rows.
