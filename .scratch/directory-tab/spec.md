# Directory tab

Status: ready-for-agent

Ticket prefix: `DIR`.

Settled by a UI prototype on live staging data and two rounds of decisions. The first round
(2026-10-03 to 2026-10-04, six grilling rounds) chose variant E, "filter everything in the
Directory", on branch `prototype/directory-tab`. The second (2026-10-06) rebuilt E's filter bar
from the Channels and Posts tabs' own parts and chose that as variant T, "tab parity", on branch
`prototype/directory-tab-bars`; two other bars, a facet rail and a typed query, were tried there
and dropped. T keeps E's table, bulk bar and detail panel. The terms **Dismissal**, **Directory
filter**, **Citing Channel**, **Shared parent** and **Shared child** are in `CONTEXT.md`;
**Condition** now names the Directory filter too. **ADR-027** records how the Directory is
searched and **ADR-028** how citations are counted; read both before changing either. The research
behind ADR-027 is `.scratch/directory-tab/research-search-index.md`.

## Problem Statement

An Account that wants more Channels to follow has one way to find them: run a Discovery report
over its Scope and read the Candidates. That only reaches Channels the Account's own Posts already
point at, one report at a time, and a Candidate list cannot be searched, sorted by size or
activity, or narrowed by Language.

Meanwhile the deployment knows far more. The Directory holds about 358K live Channels and about
238K other handles, each with its Channel counters, Reach, posting rate, Language and a sample of
recent Posts, and the References say which Channel cites which. ADR-014 built that map and said
outright that "a browsing, search or ranking surface over it is a separate feature". Nothing in
the product reads it yet, so an Account cannot ask "Persian Channels with 5K+ subscribers that
posted this week and that the Channels I follow keep citing", search them by topic, or see why one
is worth following.

## Solution

A new workspace tab, **Directory**, that lists Directory entries and lets an Account narrow them
with a **Directory filter**: the same AND/OR/NOT tree of Conditions the Channels and Posts tabs
use, over everything a Directory entry records and the References around it. Its bar is built from
those tabs' own parts, so it looks and behaves like them: the Posts tab's search box, a row of
pills (a Language menu, a Filters menu holding every Condition, on/off switches, a Reference kinds
menu, a sort picker and a Columns menu, each dropdown with its own search box), and the shared
filter row where Conditions are chips joined by AND or OR, negated, put in parentheses and dragged
into groups.

The search box finds Channels by words in their name, bio and recent Posts, in Russian, English,
Persian, Chinese and the other Languages in the corpus, and quotes the Post that matched.

Results sort by any measure. The default is "Cited by your channels", where "your channels" are the
Account's selection on the Channels tab, or every Channel it follows when nothing is selected; the
sort also offers the two other readings outright, every follow and the Channels ticked in the
Directory list itself. A detail panel shows a Channel's bio, its recent Posts with their View
counts and links, who cites it and whom it cites, and why it is in the list. The Account can follow
a Channel, follow many at once, or record a **Dismissal**, which hides the Channel here and in
Discovery reports alike.

The whole view lives in the URL, so it can be bookmarked or shared, and the last one is
remembered. Later, **Shared parents** and **Shared children** find Channels read by the same
people as, or pointing at the same places as, Channels the Account picks, including the ones it
has just ticked in the list.

## User Stories

### Opening and reading the list

1. As an Account, I want a Directory tab in the workspace, so that I can look for Channels to follow without running a Discovery report.
2. As an Account, I want the Directory tab to open and close like History and Settings, at most once, so that it does not crowd the tab strip.
3. As an Account, I want the tab to open on Channels I do not follow, have not dismissed and that can be followed, so that the first screen is already useful.
4. As an Account, I want that opening view to be an ordinary Directory filter I can see and edit, so that nothing hidden decides what I see.
5. As an Account, I want the list to open sorted by how many of my channels cite each Channel, so that Channels my own reading points at come first.
6. As an Account, I want "my channels" in that opening sort to be my selection on the Channels tab, or every Channel I follow when nothing is selected, so that the ranking is personal when I have chosen and still meaningful when I have not.
7. As an Account, I want each row to show the Channel's avatar, name, handle, Language, subscribers, Reach, posts per week, share of forwarded Posts, last post, how many Channels cite it, how many it cites, how many of my channels cite it and when the Directory found it, so that I can compare Channels at a glance.
8. As an Account, I want each row's handle to be a link that opens Telegram's public web view in a new tab, as on the Discover tab, so that I can look at a Channel without opening the panel.
9. As an Account, I want clicking a handle link not to open the detail panel, while clicking anywhere else on the row still does, so that the two actions do not collide.
10. As an Account, I want an estimated Reach marked as an estimate, so that I do not mistake it for a settled number.
11. As an Account, I want the list in pages of 100 with previous and next, so that a broad view stays fast.
12. As an Account, I want the total number of matching Channels, so that I know how wide my view is.
13. As an Account, I want that total shown as an estimate when nothing beyond the opening view's Conditions narrows the list, so that the widest views open quickly.
14. As an Account, I want the filter row to read "N of M", where M is the whole Directory, and a footer under the bar with the count, so that I see how much my filter removed, as on the Channels and Posts tabs.
15. As an Account, I want Persian, Arabic and other right-to-left names, bios and Posts laid out right to left, so that they read correctly.
16. As an Account, I want to choose which columns the table shows from a Columns menu I can search, so that it fits my screen and my question.
17. As an Account, I want the Channel column and the row's actions always shown, so that I cannot hide what I need to act.
18. As an Account, I want my column choice remembered in this browser, so that I set it once.
19. As an Account, I want columns for Shared parents and Shared children to appear only while those Conditions are on, so that the table does not carry empty columns.
20. As an Account on a narrow screen, I want the table to keep the Channel, one measure I choose and Follow, and the detail panel to take the whole screen, so that the tab is usable on a phone.

### Searching

21. As an Account, I want one large search box at the top of the bar, as on the Posts tab, so that searching is the first thing the tab offers.
22. As an Account, I want the search to match words in the Channel's name, bio and recent Posts, so that a Channel is found by what it writes about, not only by its name.
23. As an Account, I want to limit the search to name, bio or Posts with a segment inside the search box, so that I can ask narrower questions without leaving the box.
24. As an Account, I want the last word I type to match as a prefix once it has three letters, so that results appear while I type.
25. As an Account, I want Russian, English, German and Arabic word forms to match each other, so that "новости" also finds "новостей".
26. As an Account searching in Persian, I want different spellings of the same letters and words joined by a zero-width non-joiner to match, so that Persian search is not worse than Russian.
27. As an Account searching in Chinese or Japanese, I want words found inside longer runs of characters, so that those Languages are searchable at all.
28. As an Account, I want a name I mistype slightly to still find the Channel, so that I do not need the exact handle.
29. As an Account, I want results ordered by how well they match, weighted by Channel size, so that a strong match on a real Channel comes first.
30. As an Account, I want each result to quote the Post and the part of the bio that matched, with the matched words highlighted, so that I can see why it matched.
31. As an Account, I want a "Show matches" switch in the pill row to turn those quotes off, so that a long list stays compact and loads faster.
32. As an Account, I want clearing the search box to apply at once and cancel the search in flight, so that I am not waiting for a result I no longer want.
33. As an Account, I want search to combine with every Condition, so that I can ask "crypto, in Persian, posted this week".
34. As an Account, I want an active search shown as a chip in the filter row that I can clear, as on the Channels and Posts tabs, so that the search and the Conditions read as one view.

### The bar and the Directory filter

35. As an Account, I want the Directory filter to work like the Channels tab's Channel filter, with AND, OR, NOT and parentheses, so that I do not learn a second way of filtering.
36. As an Account, I want the bar laid out like the Posts tab's (the search box, then a row of pills, then the filter row, then the footer), so that the Directory feels like part of the same app.
37. As an Account, I want every dropdown in the bar (Language, Filters, Reference kinds, Sort, Columns) to open on a search box, so that I can find an item by typing in any of them.
38. As an Account, I want a Language menu, the same facet menu the Channels tab uses, listing each Language's name and how many Channels in my current view have it, so that I pick Languages that exist.
39. As an Account, I want each Language in that menu to have a funnel that keeps only it, and several funnelled Languages to join with OR, so that "Persian or English" is two clicks.
40. As an Account, I want to exclude a Language by negating its chip, so that "everything but Russian" uses the same NOT as every other Condition.
41. As an Account, I want the Language menu's pill to name the Language I funnelled, so that the bar says what it shows.
42. As an Account, I want a Filters pill that opens one searchable list of every Condition, grouped as Channel, Size and activity, Content and References, with a count of the Conditions on, so that I can find a measure without knowing where it lives.
43. As an Account, I want on/off switches in the pill row for "Hide followed", "Hide dismissed" and "Followable only", so that the opening view's three rules are one click each.
44. As an Account, I want those switches to edit the filter's own Conditions, and to show as off when I have put those Conditions inside an OR, so that the switches and the chips never disagree.
45. As an Account, I want to bound subscribers, Reach, posts per week, share of forwarded Posts, days since the last post, days since the Directory found it, and the photo, video, file and link counters, so that I can describe the kind of Channel I want.
46. As an Account, I want the editor for a bound to draw how that measure is spread across my current view, on a log scale with its median, and to set the bound when I click a bar, so that I choose a bound that means something.
47. As an Account, I want to bound a measure at least, at most, between, or ask for entries with no value, so that I can find what Telegram did not show as well as what it did.
48. As an Account, I want to be told how many entries have no value for a measure and so fail any bound on it, so that a bound does not silently drop them.
49. As an Account, I want quick choices of 1, 7, 30, 90 and 365 days for measures counted in days, so that common windows are one click.
50. As an Account, I want the editor to tell me how many Channels the Condition would leave before I add it, so that I do not add one that empties the list.
51. As an Account, I want a "Name contains" Condition that matches any part of a handle or display name, so that "news" finds @dailynewsfa, which a word search cannot.
52. As an Account, I want Conditions for "cited by at least N Channels" and "cites at least N Channels", counted in distinct Citing Channels, so that I can find Channels the corpus talks about.
53. As an Account, I want "cited by @handle" and "cites @handle", for one or several handles, so that I can explore around a Channel I know.
54. As an Account, I want one Reference kinds pill (forward, mention, link, reply) that narrows every count and Condition about References in the view, so that I can ask about forwards only without setting it on each Condition.
55. As an Account, I want Conditions for Followed, Dismissed and Followable, so that the opening view's rules are ones I can change.
56. As an Account, I want each active Condition shown as a chip that reopens its editor, so that I can adjust without starting over.
57. As an Account, I want to negate any chip, switch any joiner between AND and OR, put any chip in parentheses, and drag one chip onto another to group them, as on the Channels tab, so that I can build any filter without typing it.
58. As an Account, I want to remove any Condition or clear them all, so that I can start again quickly.
59. As an Account, I want a sort picker I can search, with a direction arrow, so that I choose what "best" means.
60. As an Account, I want measures counted in days to sort newest first by default, so that "last post" sorts the way I expect.
61. As an Account, I want to click a column header to sort by it, so that sorting is where I am looking.

### Cited by your channels

62. As an Account, I want the sort to offer "Cited by channels you follow", "Cited by your Channels tab selection" and "Cited by channels ticked here" as three separate choices, so that I say exactly whose citations rank the list.
63. As an Account, I want the choice I make there to decide whose citations the "Yours" column, the "Cited by your channels" Condition and the "days since your channels last cited it" sort count, so that the number I sort by is the number I see.
64. As an Account, I want that choice kept with the rest of the view, so that a reload or a shared link counts the same channels.
65. As an Account, I want the Channels tab selection to include selected Channels the Channel filter hides, so that the Directory agrees with the Channels tab about what I selected.
66. As an Account, I want "Channels ticked here" to follow my ticks in the list as I change them, so that I can rank the Directory by a shortlist I am building.
67. As an Account, I want to be told when the source I chose is empty (nothing selected on the Channels tab, or nothing ticked) and that every count is therefore 0, so that an all-zero column does not look like a bug.
68. As an Account, I want a Condition "Cited by your channels" with an optional window of any number of days, so that I can ask what my channels are pointing at this week.
69. As an Account, I want to see, in the row, how many of my channels cite a Channel and how long ago the last one did, so that recent attention stands out.

### The detail panel

70. As an Account, I want clicking a row to open a panel with the Channel's avatar, name, handle, counters and bio, so that I can judge it without leaving the tab.
71. As an Account, I want the panel to open even when its Channel is not on the current page, so that a remembered or shared panel still works.
72. As an Account, I want the panel to show the Channel's stored sample Posts, newest first, so that I can read what it publishes.
73. As an Account, I want only the newest three shown until I ask for more, and each long Post clamped until I expand it, so that the panel stays short.
74. As an Account, I want each Post's View count, and when it was counted, so that I can judge real attention.
75. As an Account, I want Posts that carry media marked, and Posts with no text shown as media only, so that nothing looks missing.
76. As an Account, I want handles and addresses in a Post to be links, as on the Posts tab, so that I can follow them.
77. As an Account, I want links the Post hides behind other words listed under it, so that I see every place it points.
78. As an Account, I want links to a Channel or Post to open Telegram's public web view, so that I can read it without the app.
79. As an Account, I want "Why it's here": the Posts of my channels that cite this Channel, counting the same channels the sort counts, so that I see what made it rank.
80. As an Account, I want the panel to list the Channels that cite this one most and those it cites most, so that I can explore around it.
81. As an Account, I want one click from those lists to add "cited by @x" or "cites @x" to my filter, so that a neighbour becomes a Condition.

### Following, ticking and Dismissal

82. As an Account, I want a Follow button on every row and in the panel, so that following is one click.
83. As an Account, I want Follow to run the same follow job Discover uses, so that the first sync, Quota and Setting group behave exactly as they do there.
84. As an Account, I want a Follow made from the Directory to record the newest Reference from my channels as where it was discovered, when there is one, so that I can later see why I followed it.
85. As an Account, I want to tick rows and follow them together, so that I can act on a shortlist.
86. As an Account, I want a header checkbox that ticks every unfollowed Channel on the page, showing a partial state when some are ticked, so that ticking a page is one click.
87. As an Account, I want Channels I already follow shown as checked and locked, as in Discover, so that I do not try to follow them again.
88. As an Account, I want a bar showing how many I ticked, a few of their handles, and Follow, Dismiss and Clear, so that I know what a bulk action will touch.
89. As an Account, I want to confirm before following five or more Channels at once, as Discover asks, so that a slip does not start many syncs.
90. As an Account, I want my ticks kept across pages and filter changes until I clear them, so that I can build a shortlist from several views.
91. As an Account, I want to dismiss a Channel from a row, the panel or the bulk bar, so that it stops appearing.
92. As an Account, I want a Dismissal to hide the Channel in Discovery reports too, and a Dismissal made there to hide it here, so that I reject a Channel once.
93. As an Account, I want an Undo on the confirmation that stays long enough to reach, so that a wrong click is recoverable.
94. As an Account, I want to list my dismissed Channels and take a Dismissal back, so that I can change my mind.
95. As an Account, I want Follow withheld on a dismissed Channel until I take the Dismissal back, as Discover does, so that the two tabs agree.
96. As an Account, I want my Dismissals to be mine alone, so that another Account's choices do not hide Channels from me.

### Sharing and memory

97. As an Account, I want the Directory filter, the search and its fields, the sort and its direction, the "your channels" choice, the Reference kinds and the page in the URL, the filter in the same readable text form the Channels tab uses, so that I can bookmark or share a view.
98. As an Account, I want a shared link to open exactly that view, so that a colleague sees what I saw.
99. As an Account, I want my last view remembered, so that reloading or coming back to the tab does not reset it.
100. As an Account, I want the open panel remembered in this browser, so that a reload does not lose my place.

### Shared parents and Shared children

101. As an Account, I want a Condition "Shared parents with" a set of picks, so that I find Channels cited by the same Channels that cite the ones I like.
102. As an Account, I want a Condition "Shared children with" a set of picks, so that I find Channels that cite the same places the ones I like cite.
103. As an Account, I want the picks to be the Channels ticked in this list (live), the Channels ticked in this list as they are now (saved), my Channels tab selection, every Channel I follow, or handles I type, so that I can start from any of them.
104. As an Account, I want each of those choices labelled with its count and one line saying whether it follows later changes or stays fixed, so that I know what I am choosing.
105. As an Account, I want the saved choice to store the ticked handles, so that editing it later shows them as handles I can change.
106. As an Account, I want to be told that a Channel I tick while the live choice is on leaves the results, because it is now one of the picks, so that a row vanishing does not look like a bug.
107. As an Account, I want to set how many shared Channels a candidate needs, so that I control how strict the match is.
108. As an Account, I want each of them to add a column with the shared count and a sort weighted against how connected the candidate is overall, so that giants do not win by size.
109. As an Account, I want "Why it's here" to name a few of the shared Channels, so that I can check the match.
110. As an Account, I want to be told that Shared children work only from Channels somebody follows, so that an empty result does not look like a bug.

### Viewing as another Account, and access

111. As an Owner viewing as another Account, I want to browse the Directory as that Account sees it, so that I can help with what they see.
112. As an Owner viewing as another Account, I want Follow and Dismissal refused unless the session is elevated, so that read-only View-as stays read-only.
113. As an Operator, I want every approved Account to use the Directory with no extra Permission, so that I do not grant one by hand.
114. As an Account awaiting approval, I want the Directory refused like every other data tab, so that approval keeps meaning what it means.
115. As an Operator, I want the database container's shared memory raised, so that large parallel queries stop failing on staging. (Done: DIR-01.)

## Implementation Decisions

- **Six deep modules**: the database's shared memory (an operations change, done); the Dismissal (a rename); the citation pairs (ADR-028); the search index (ADR-027); the Directory read model behind one endpoint family; the Directory tab. The tickets cut across them as vertical slices (see Further Notes), so each module arrives with the first ticket that needs it.
- **Dismissal.** One per Account, shared by Discovery reports and the Directory. Discover's dismissal table is renamed to match the glossary, along with its model and service and every inventory that lists it: the tenancy seam, the export omissions (a Dismissal is deliberately not exported, and keeps that reason) and the test cleanup inventory. Discover's behaviour and wire contract do not change. Follow stays withheld on a dismissed Channel.
- **Citation pairs (ADR-028).** One row per distinct citing Channel and cited Channel with its Reference count, and per handle the number of distinct Channels it is cited by and cites. Written by the References writer in the transaction that inserts References, from the rows it reports as new; a pair that did not exist raises its two counts by one. Keyed by handle, not by Directory entry. References are permanent, so nothing decrements. A first-fill script builds both from the existing References.
- **Search index (ADR-027).** A companion table, one row per live Channel entry, owned by the Directory aggregate as its payload table and scoped corpus: a tsvector of the handle and display name (weight A), the bio (B) and the 8 newest samples capped at 12,000 characters (C), a GIN index with fast update off, and a trigram index over handle and display name. The text search configuration comes from the entry's Language (russian, english, german, arabic; everything else simple). Python normalises text before indexing and before querying: Persian letter variants folded, the zero-width non-joiner turned into a space, Chinese and Japanese runs split into overlapping character pairs. The row is rebuilt in the same transaction as every writer that changes its inputs (a probe result, a metadata sync, a recheck, sample retention), and deleted when the entry stops being a live Channel. An index version lets a recipe change re-index old rows in the background.
- **Search query.** Every word but the last matches whole; the last matches as a prefix from three characters. Each word is tried under every configuration in use and the words are joined with AND. A trigram match on the name is ORed in for typos. Relevance is match strength times the log of subscribers. Snippets are cut in Python, for the rows on the page only, from the same normalised text, highlighting words that start with a matched lexeme.
- **Directory filter.** A tree of Conditions with AND, OR, NOT and parentheses, reusing the shared filter tree: its data model, its text form's grammar, and the condition picker, facet menu, filter row and sort picker components. The browser sends the tree; only the server evaluates it, as the Post filter already works. Each Condition compiles to one boolean expression and the tree joins them; an empty group passes everything, negated or not. The vocabulary is closed and the tree is bounded in depth and size, as the Post filter's is.
- **Conditions.** Language; Name contains (case-insensitive, any part of the handle or the display name); bounds on subscribers, Reach, posts per week, forwarded share, days since last post, days since the Directory found it, photos, videos, files and links, each with "no value"; cited by at least N Channels; cites at least N Channels; cited by @handle and cites @handle (one or more handles); Cited by your channels (optional window in days); Followed; Dismissed; Followable; and later Shared parents with and Shared children with. Every Condition can be negated. "Followable" reads the Directory entry's followability verdict. There is no "has a profile photo" Condition: every Directory entry on staging has a photo address (0 of 358,465 lack one), so it would narrow nothing.
- **Reference kinds are one setting for the whole view**, not a field on each Condition. It narrows "cited by @handle", "cites @handle", "Cited by your channels", the "Yours" column and its sort. The counts ADR-028 stores (cited by N, cites N) are over every kind and are not narrowed.
- **"Your channels"** is a view setting with three values: every Channel the Account follows; its Channels tab selection, which includes the Hidden selection and is not the Scope (the Analysis window and the Post selection do not apply); or the Channels ticked in the Directory list. The sort picker offers "Cited by your channels" once per value, and choosing one sets the view's value; the "Yours" column, the "Cited by your channels" Condition, the "days since your channels last cited it" sort, "Why it's here" and discovered-via all read the same value. A view with no stored value starts on the selection when the Channels tab has one and on every follow otherwise; a value chosen explicitly is never swapped silently, so an empty selection or an empty tick list counts 0 for every row and the bar says so.
- **"Cited by your channels"** counts distinct channels of the chosen set whose Posts make a Reference to the Channel, over all time unless the Condition sets a window. The browser sends the handles for the selection and the ticks and a flag for every follow, which the server resolves from the Account's Follows; the server counts live from the References by source, which measured under a second on staging for every follow at once, and about 0.6 s for three ticked Channels.
- **The opening view** is the filter `not followed and not dismissed and followable`, sorted by "Cited by your channels", highest count first. How equal counts are ordered is not decided (see Further Notes).
- **The read endpoint family** lives in the Directory route module and takes the Directory filter, the search (text, fields, snippets on or off), the sort and its direction, the page, the "your channels" value with the handles it needs, the Reference kinds, and the resolved picks for Shared parents and Shared children. It returns a light list: per row the Directory entry's measures, cited-by and cites counts, the your-channels count and its latest time, Followed and Dismissed flags, and the search snippets. Never the bio or samples, which the detail reads. It also returns the total and the Language counts for the view without its Language Conditions. Totals are estimates when no search and no Condition beyond the opening view's three (Followed, Dismissed, Followable, which barely narrow it) is on, exact otherwise; totals and Language counts are cached per Account and view for a few minutes, and a Dismissal drops that Account's cache. Separate operations return a measure's distribution for the bound editor, a count-only preview, and the size of the whole Directory for the filter row's "of M".
- **Because the filter travels in a request body, the list operation is a POST.** It is declared read-only in View-as's inventory, as the Posts tab's feed is, so a View-as session can browse while Follow and Dismissal stay refused unless elevated. Every response model is declared and closed; the routes carry the approval gate and the auth dependency, and the account-isolation probe covers them with two Accounts.
- **Picking the page first.** The page is chosen from the Directory entry and the search index alone unless a Condition or the sort reads citation counts or the your-channels count; those are then joined to the page's rows only. That kept the unfiltered page well under a second in the prototype.
- **No parallel workers are assumed.** The database's shared memory was raised as its own change (DIR-01), ahead of this work.
- **Detail.** The existing route that returns a Directory entry's samples already returns them whole with View counts. It gains each sample's Links, which carry no position in the text, so the panel turns visible handles and addresses into links and lists the rest under the Post; the time the sample was captured; and whether the Post carries media, read from its media kinds rather than from the presence of a media block, which nearly every sample has. A neighbours operation returns the Channels citing it most and those it cites most, from the citation pairs, with names.
- **Follow from the Directory** uses the existing bulk follow job, single or many, and records as discovered-via the newest Reference from the chosen "your channels" to that Channel when one exists.
- **The tab.** A new Closable tab, open at most once, called Directory. Its bar is variant T's and is assembled from shared components, with no Directory-only copies of them:
  - the Posts tab's search box, full width, with the Name, Bio and Posts field toggles as a segment inside it;
  - a pill row: the shared facet menu for Language (funnels only, joined with OR; no tick column, since the Directory has no selection to tick into); a Filters pill that opens the shared condition picker; the Channels tab's on/off pill switches for Hide followed, Hide dismissed and Followable only; a Reference kinds pill; a divider; the shared sort picker with its direction arrow; a "Show matches" switch; and, at the end, a Columns pill;
  - the shared filter row, with the "N of M" count, the search as a chip, and Clear all;
  - the Posts tab's footer: the count, the time the list took, a notice when "your channels" is empty, and the Directory's size.
  Every dropdown opens on a search box: Language, Filters, Reference kinds, Sort and Columns. A switch is "on" only when its Condition sits on the filter's top-level AND; turning it on or off edits that Condition, wrapping the filter in a new AND first when its top level is an OR. The table, the bulk bar and the detail panel follow the prototype's variant E, except that each row's handle is a link to Telegram's public web view, styled and opened as Discover's are, which does not open the panel. Undo toasts stay up for ten seconds.
- **State.** The Directory filter, the search and its fields, "Show matches", the sort and its direction, the "your channels" value, the Reference kinds and the page live in the URL: the filter as one parameter in the shared text form, the rest beside it. The last view is also remembered per Account in browser storage through the scoped storage, and a tab opened without them adopts it. The ticks, the open panel and the hidden columns are per browser only; the ticks are never in the URL, so a shared link whose "your channels" or picks are "the Channels ticked here" counts the receiver's ticks, which start empty.
- **The filter's text form** gains the Directory's Conditions, from the prototype (trimmed to the grammar, not the parser):

  ```
  lang:fa   is:followed   is:dismissed   is:followable   name:"news"
  subscribers >= 1000   reach 100..5000   reach = none   last_post_days <= 7
  citedby:durov   cites:"a b"   mine:14d   mine:all
  parents:selection   parents:follows   parents:picked   children:"a b 3"   (a trailing number is the minimum, default 2)
  not   and   or   ( )
  ```

  A bare word reads as Name contains, so typing a word into the text form does something.
- **Shared parents and Shared children** read the citation pairs. Each has its own picks and its own minimum shared count, defaulting to 2; when both are on, a Channel must pass both; sources citing more than 3,000 Channels, and targets cited by more than 3,000, are skipped as aggregators. The picks are one of five: the Channels ticked in the list, live, which re-resolves on every tick; the Channels ticked in the list as they are when the Condition is added, saved as typed handles; the Channels tab selection; every Follow; or typed handles. The editor lists them under "Compared with", each with its count and a line saying whether it follows later changes, offers the two ticked choices only while something is ticked, and pre-selects the live ticked choice when there are ticks. A pick is never its own candidate, so a Channel ticked under the live choice leaves the results; the live choice's line says so. Each Condition adds a count column and a sort on the count weighed against the candidate's overall degree, and a line in "Why it's here".
- **Every new table is placed in the repo's inventories.** The search rows, the citation pairs and the citation counts are corpus-scoped in the tenancy seam, listed in the test cleanup inventory, and omitted from export with a reason: each is derived, and rebuilt from the Directory or the References. The renamed Dismissal table keeps its tenancy scope and its export omission, with its reason, under the new name.
- **Service kinds.** The search rows are the Directory aggregate's payload. The citation pairs and counts are the References aggregate's payload, with the References writer their sole writer. The Directory list, detail, neighbours, distribution and count reads form one read model.
- **Responses reach the frontend through the generated client**, per the two-client split; nothing on these routes returns an open dictionary.
- **Columns.** Hiding a column is per browser and per Account, and clearing the filter does not reset it. The Columns menu searches each column's name and description.
- **Prototype snippet: the two rankings** the prototype measured to behave well (from the prototype API, trimmed to the decision):

  ```
  relevance  = text_rank(name A, bio B, posts C) * ln(10 + subscribers)
  shared     = shared_count / sqrt(degree(candidate) * count(picks' Citing Channels or cited Channels))
  ```

- **Glossary.** The Closable tab entry gains the Directory tab. "Your channels" in the Directory is not a glossary term: it is a view setting, named in the UI by the sort choice that sets it.

## Testing Decisions

- **A good test asserts what an Account can observe** through the highest seam available, never the shape of a query or a private helper. Data is set up through the real write paths (recording a probe result, writing References), never by inserting index or count rows directly, so a writer that forgets the index fails the test.
- **Main seam: the Directory HTTP API**, in pytest against the test database with two live Accounts, each with its own Follows, selected Channels and Dismissals, over one small shared corpus of Directory entries, samples and References laid out in a table at the top of the module. It covers every Condition, negation and nesting (including an OR that holds one of the opening view's three Conditions), Name contains, the opening view, the three "your channels" values and the empty-source case that counts 0, the Reference kinds setting narrowing every Reference Condition and the "Yours" count, the search box (a Russian word form, a Persian letter variant, a Chinese word inside a run, a typo in a name, field limits, the prefix rule), snippets on and off, every sort, estimated and exact totals, the Directory's size, Language counts, the distribution and count-preview operations, Shared parents and Shared children from typed handles and from sent ticks, Dismissal visibility in both Accounts and in Discover, and View-as refusals. Prior art: the Post filter tree's end-to-end API test, which uses the same two-account, table-of-rows shape and lists the mutations it was watched to fail on.
- **Writer seams, existing:** after every writer that changes a search row's inputs, the stored row equals a fresh rebuild; after the References writer runs, the citation counts equal a fresh aggregation over the References. Prior art: the Directory statistics write-path guard.
- **The Directory filter's text form**, as a pure library: text parses and prints back unchanged (including `name:`, `mine:`, and every picks form with and without a minimum), malformed text and an unknown `is:` are refused, and the vocabulary is closed. Prior art: the Post filter's and Channel filter's text-form tests, and the prototype's round-trip check.
- **One Playwright journey with a mocked API**: open the tab, type a search and see it as a chip, funnel a Language, turn a switch off and on and see its chip come and go, add a bound through the Filters picker, search the Sort, Reference kinds and Columns dropdowns, choose "Cited by channels ticked here", see the URL change and survive a reload, open a shared link, tick rows, confirm a bulk follow of five, dismiss and undo, and check a row's handle is a Telegram web view link that does not open the panel. Prior art: the Discover Playwright spec. It runs serially, as every Playwright spec here does.
- **Component render tests** for every new branching component, which the frontend CRAP ratchet requires: at least the bound editor, the Shared parents and children editor, the bulk bar, the switch row and the detail panel's sample list. Test files are type-checked separately from the build, as CI does.
- **Repository guards come along, not new seams:** route inventory, route module hygiene, account isolation (every new operation probed with two Accounts), the approval gate, View-as's inventory, service kinds, the tenancy seam's table classification, the test cleanup inventory and the export inventory. Each guard is watched to fail once before it is trusted.

## Out of Scope

- Semantic search with embeddings. It comes later as a second ranked list merged with keyword results, with its own ADR superseding ADR-005.
- A separate search service, ParadeDB, PGroonga or pg_bigm.
- Probing handles that have no followability verdict yet. Discover's recheck stays the way to probe them.
- Replacing or merging Discover. The two tabs coexist; revisit after the Directory has real use.
- The prototype's reference graph view (variant G) and "walk from Channel to Channel".
- The two other bars tried on 2026-10-06: a facet rail with every Condition open in a sidebar (variant R), and a typed query line with autocomplete (variant Q). The text form stays in the URL; it is not an input.
- Reference kinds on each Condition. One view-level setting covers it.
- Exclude and "only this" buttons in the Language menu. Negating a chip excludes; the funnel keeps only.
- A "has a profile photo" Condition.
- A "Rising" signal (References in the last 7 days against the 7 before) and an engagement measure (View counts against subscribers). Both were proposed and not yet decided.
- Keyboard triage of rows.
- Saved, named views beyond the URL.
- Topic labels for Channels.
- Any change to how the Directory is filled, probed or refreshed, or to how References are extracted.
- A Permission for the tab: every approved Account can use it.

## Further Notes

- The prototype is the primary source, on two branches: `prototype/directory-tab` holds variant E (with B and C folded in) and its handoff `.scratch/channel-find/prototype.md`; `prototype/directory-tab-bars` builds on it with variant T, the tree compiled to SQL in the prototype API, and the "your channels" and ticked-picks decisions. Its throwaway API read staging live through a read-only role. None of its code is to be promoted as is.
- The prototype measured on staging: search over 318K Channels in 0.2 to 2.7 s including a ~200 ms tunnel; the unfiltered page in 0.24 s of database time with counts cached; "cited by every follow in the last 14 days" in 0.28 s; Shared parents across 333 follows in 1.4 s. With the tree, the opening view took 2.7 s uncached, "Persian or English with 10K+ subscribers" 0.9 s, "cites or cited by @durov" 1.2 s, and the whole Directory's count 0.3 s cached. A parallel hash join over References overflowed the database container's 64 MB shared memory and failed with "could not resize shared memory segment".
- The bound editor's count preview ANDs the candidate onto the filter. When the measure sits inside an OR the preview is approximate; making it exact means the editor sends the Condition's place in the tree.
- Under "Cited by your channels" most rows tie at 1 or 2, and the prototype breaks ties by handle, which reads as alphabetical. Breaking ties by the most recent citation from the chosen channels was proposed and not decided.
- Only Channels somebody follows have their own Posts read, so only they have outbound References. Ticking a Channel nobody follows, such as @durov, adds nothing to "Cited by channels ticked here" or to Shared children.
- The prototype called Reach "average views per post"; the glossary defines it as the median Settled View count of recent Posts, and the tab must say so.
- A plain @mention is stored as both a mention and a link Reference. Every count here is in distinct Citing Channels or distinct Posts, never in Reference rows.
- The Directory keeps growing while it is being read; totals that move by one or two between two reads are expected.
- Tickets, as vertical slices (`issues/`): DIR-01 shared memory is done; DIR-02 browse the Directory starts at once; DIR-03 read a Channel and DIR-04 search follow DIR-02; DIR-05 who cites whom and DIR-06 Dismissal follow DIR-03; DIR-07 Shared parents and Shared children follows DIR-05. This replaces the layered order agreed during grilling, which put every table before the endpoint.
