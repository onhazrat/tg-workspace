# Directory tab

Status: ready-for-agent

Ticket prefix: `DIR`.

Settled by a UI prototype on live staging data (2026-10-03 to 2026-10-04; the winning variant E,
"filter everything in the Directory", is on branch `prototype/directory-tab`) and six grilling rounds
on 2026-10-04. The terms **Dismissal**, **Directory filter**, **Citing Channel**, **Shared
parent** and **Shared child** are in `CONTEXT.md`; **Condition** now names the Directory filter
too. **ADR-027** records how the Directory is searched and **ADR-028** how citations are counted;
read both before changing either. The research behind ADR-027 is
`.scratch/directory-tab/research-search-index.md`.

## Problem Statement

An Account that wants more Channels to follow has one way to find them: run a Discovery report
over its Scope and read the Candidates. That only reaches Channels the Account's own Posts already
point at, one report at a time, and a Candidate list cannot be searched, sorted by size or
activity, or narrowed by Language.

Meanwhile the deployment knows far more. The Directory holds about 320K live Channels and about 238K
other handles, each with its Channel counters, Reach, posting rate, Language and a sample of
recent Posts, and the References say which Channel cites which. ADR-014 built that map and said
outright that "a browsing, search or ranking surface over it is a separate feature". Nothing in
the product reads it yet, so an Account cannot ask "Persian Channels with 5K+ subscribers that
posted this week and that the Channels I selected keep citing", search them by topic, or see why
one is worth following.

## Solution

A new workspace tab, **Directory**, that lists Directory entries and lets an Account narrow them
with a **Directory filter**: the same AND/OR/NOT tree of Conditions the Channels and Posts tabs
use, over everything a Directory entry records and the References around it. A search box beside
the filter finds Channels by words in their name, bio and recent Posts, in Russian, English,
Persian, Chinese and the other Languages in the corpus, and quotes the Post that matched.

Results sort by any measure, with "cited by the selected Channels" as the default, so the tab
opens on Channels the Account's own reading points at. A detail panel shows a Channel's bio, its
recent Posts with their View counts and links, who cites it and whom it cites, and why it is in
the list. The Account can follow a Channel, follow many at once, or record a **Dismissal**, which
hides the Channel here and in Discovery reports alike.

The whole view lives in the URL, so it can be bookmarked or shared, and the last one is
remembered. Later, **Shared parents** and **Shared children** find Channels read by the same
people as, or pointing at the same places as, Channels the Account picks.

## User Stories

### Opening and reading the list

1. As an Account, I want a Directory tab in the workspace, so that I can look for Channels to follow without running a Discovery report.
2. As an Account, I want the Directory tab to open and close like History and Settings, at most once, so that it does not crowd the tab strip.
3. As an Account, I want the tab to open on Channels I do not follow, have not dismissed and that can be followed, so that the first screen is already useful.
4. As an Account, I want that opening view to be an ordinary Directory filter I can see and edit, so that nothing hidden decides what I see.
5. As an Account, I want the list sorted by how many of my selected Channels cite each Channel, so that Channels my own reading points at come first.
6. As an Account with no Channels selected, I want the list sorted by Reach and a hint to select Channels for a personal ranking, so that the tab is never empty or meaningless.
7. As an Account, I want each row to show the Channel's avatar, name, handle, Language, subscribers, Reach, posts per week, share of forwarded Posts, last post, how many Channels cite it, how many it cites, how many of my selected Channels cite it and when the Directory found it, so that I can compare Channels at a glance.
8. As an Account, I want an estimated Reach marked as an estimate, so that I do not mistake it for a settled number.
9. As an Account, I want the list in pages of 100 with previous and next, so that a broad view stays fast.
10. As an Account, I want the total number of matching Channels, so that I know how wide my view is.
11. As an Account, I want that total shown as an estimate when nothing beyond the opening view's Conditions narrows the list, so that the widest views open quickly.
12. As an Account, I want Persian, Arabic and other right-to-left names, bios and Posts laid out right to left, so that they read correctly.
13. As an Account, I want to choose which columns the table shows, so that it fits my screen and my question.
14. As an Account, I want the Channel column and the row's actions always shown, so that I cannot hide what I need to act.
15. As an Account, I want my column choice remembered in this browser, so that I set it once.
16. As an Account, I want columns for Shared parents and Shared children to appear only while those Conditions are on, so that the table does not carry empty columns.
17. As an Account on a narrow screen, I want the table to keep the Channel, one measure I choose and Follow, and the detail panel to take the whole screen, so that the tab is usable on a phone.

### Searching

18. As an Account, I want a search box beside the Directory filter, so that I can find Channels by topic.
19. As an Account, I want the search to match words in the Channel's name, bio and recent Posts, so that a Channel is found by what it writes about, not only by its name.
20. As an Account, I want to limit the search to name, bio or Posts, so that I can ask narrower questions.
21. As an Account, I want the last word I type to match as a prefix once it has three letters, so that results appear while I type.
22. As an Account, I want Russian, English, German and Arabic word forms to match each other, so that "новости" also finds "новостей".
23. As an Account searching in Persian, I want different spellings of the same letters and words joined by a zero-width non-joiner to match, so that Persian search is not worse than Russian.
24. As an Account searching in Chinese or Japanese, I want words found inside longer runs of characters, so that those Languages are searchable at all.
25. As an Account, I want a name I mistype slightly to still find the Channel, so that I do not need the exact handle.
26. As an Account, I want results ordered by how well they match, weighted by Channel size, so that a strong match on a real Channel comes first.
27. As an Account, I want each result to quote the Post and the part of the bio that matched, with the matched words highlighted, so that I can see why it matched.
28. As an Account, I want to turn those quotes off, so that a long list stays compact and loads faster.
29. As an Account, I want clearing the search box to apply at once and cancel the search in flight, so that I am not waiting for a result I no longer want.
30. As an Account, I want search to combine with every Condition, so that I can ask "crypto, in Persian, posted this week".

### The Directory filter

31. As an Account, I want the Directory filter to work like the Channels tab's Channel filter, with AND, OR, NOT and parentheses, so that I do not learn a second way of filtering.
32. As an Account, I want facet buttons for the Conditions I use most, each showing how many of its Conditions are on, so that I can see what is active.
33. As an Account, I want a Language menu that shows each Language's name and how many Channels in my current view have it, so that I pick Languages that exist.
34. As an Account, I want to include, exclude, or keep only one Language from that menu, so that "everything but Russian" is one click.
35. As an Account, I want one searchable list of every Condition, so that I can find a measure without knowing where it lives.
36. As an Account, I want to bound subscribers, Reach, posts per week, share of forwarded Posts, days since the last post, days since the Directory found it, and the photo, video, file and link counters, so that I can describe the kind of Channel I want.
37. As an Account, I want the editor for a bound to draw how that measure is spread across my current view, on a log scale with its median, and to set the bound when I click a bar, so that I choose a bound that means something.
38. As an Account, I want to bound a measure at least, at most, between, or ask for entries with no value, so that I can find what Telegram did not show as well as what it did.
39. As an Account, I want to be told how many entries have no value for a measure and so fail any bound on it, so that a bound does not silently drop them.
40. As an Account, I want quick choices of 1, 7, 30, 90 and 365 days for measures counted in days, so that common windows are one click.
41. As an Account, I want any Condition to be negated, so that I can exclude as easily as include.
42. As an Account, I want the editor to tell me how many Channels the Condition would leave before I add it, so that I do not add one that empties the list.
43. As an Account, I want a Condition for having a profile photo, so that I can skip empty placeholder Channels.
44. As an Account, I want Conditions for "cited by at least N Channels" and "cites at least N Channels", counted in distinct Citing Channels, so that I can find Channels the corpus talks about.
45. As an Account, I want "cited by @handle" and "cites @handle", for one or several handles, so that I can explore around a Channel I know.
46. As an Account, I want each Condition about References to take Reference kinds (forward, mention, link, reply), so that I can ask about forwards only.
47. As an Account, I want Conditions for Followed, Dismissed and Followable, so that the opening view's rules are ones I can change.
48. As an Account, I want each active Condition shown as a chip that reopens its editor, so that I can adjust without starting over.
49. As an Account, I want to remove any Condition or clear them all, so that I can start again quickly.
50. As an Account, I want to sort by any measure and flip the direction, so that I choose what "best" means.
51. As an Account, I want measures counted in days to sort newest first by default, so that "last post" sorts the way I expect.
52. As an Account, I want to click a column header to sort by it, so that sorting is where I am looking.

### Cited by the selected Channels

53. As an Account, I want a Condition and a sort for how many of my selected Channels cite a Channel, so that my own reading ranks the Directory.
54. As an Account, I want that count to include selected Channels the Channel filter hides, so that the Directory agrees with the Channels tab about what I selected.
55. As an Account, I want to limit it to the last N days, any number, so that I can ask what my Channels are pointing at this week.
56. As an Account, I want to see, in the row, how many of my selected Channels cite a Channel and how long ago the last one did, so that recent attention stands out.

### The detail panel

57. As an Account, I want clicking a row to open a panel with the Channel's avatar, name, handle, counters and bio, so that I can judge it without leaving the tab.
58. As an Account, I want the panel to open even when its Channel is not on the current page, so that a remembered or shared panel still works.
59. As an Account, I want the panel to show the Channel's stored sample Posts, newest first, so that I can read what it publishes.
60. As an Account, I want only the newest three shown until I ask for more, and each long Post clamped until I expand it, so that the panel stays short.
61. As an Account, I want each Post's View count, and when it was counted, so that I can judge real attention.
62. As an Account, I want Posts that carry media marked, and Posts with no text shown as media only, so that nothing looks missing.
63. As an Account, I want handles and addresses in a Post to be links, as on the Posts tab, so that I can follow them.
64. As an Account, I want links the Post hides behind other words listed under it, so that I see every place it points.
65. As an Account, I want links to a Channel or Post to open Telegram's public web view, so that I can read it without the app.
66. As an Account, I want "Why it's here": the Posts of my selected Channels that cite this Channel, so that I see what made it rank.
67. As an Account, I want the panel to list the Channels that cite this one most and those it cites most, so that I can explore around it.
68. As an Account, I want one click from those lists to "all Channels citing @x" or "all Channels @x cites", so that a neighbour becomes a filter.

### Following and Dismissal

69. As an Account, I want a Follow button on every row and in the panel, so that following is one click.
70. As an Account, I want Follow to run the same follow job Discover uses, so that the first sync, Quota and Setting group behave exactly as they do there.
71. As an Account, I want a Follow made from the Directory to record the newest Reference from my selected Channels as where it was discovered, when there is one, so that I can later see why I followed it.
72. As an Account, I want to tick rows and follow them together, so that I can act on a shortlist.
73. As an Account, I want a header checkbox that picks every unfollowed Channel on the page, showing a partial state when some are picked, so that picking a page is one click.
74. As an Account, I want Channels I already follow shown as checked and locked, as in Discover, so that I do not try to follow them again.
75. As an Account, I want a bar showing how many I picked, a few of their handles, and Follow, Dismiss and Clear, so that I know what a bulk action will touch.
76. As an Account, I want to confirm before following five or more Channels at once, as Discover asks, so that a slip does not start many syncs.
77. As an Account, I want my picks kept across pages and filter changes until I clear them, so that I can build a shortlist from several views.
78. As an Account, I want to dismiss a Channel from a row, the panel or the bulk bar, so that it stops appearing.
79. As an Account, I want a Dismissal to hide the Channel in Discovery reports too, and a Dismissal made there to hide it here, so that I reject a Channel once.
80. As an Account, I want an Undo on the confirmation that stays long enough to reach, so that a wrong click is recoverable.
81. As an Account, I want to list my dismissed Channels and take a Dismissal back, so that I can change my mind.
82. As an Account, I want Follow withheld on a dismissed Channel until I take the Dismissal back, as Discover does, so that the two tabs agree.
83. As an Account, I want my Dismissals to be mine alone, so that another Account's choices do not hide Channels from me.

### Sharing and memory

84. As an Account, I want the Directory filter, the search, the sort and the page in the URL, in the same readable text form the Channels tab uses, so that I can bookmark or share a view.
85. As an Account, I want a shared link to open exactly that view, so that a colleague sees what I saw.
86. As an Account, I want my last view remembered, so that reloading or coming back to the tab does not reset it.
87. As an Account, I want the open panel remembered in this browser, so that a reload does not lose my place.

### Shared parents and Shared children

88. As an Account, I want a Condition "Shared parents with" a set of picks, so that I find Channels cited by the same Channels that cite the ones I like.
89. As an Account, I want a Condition "Shared children with" a set of picks, so that I find Channels that cite the same places the ones I like cite.
90. As an Account, I want the picks to be my selected Channels, everything I follow, or handles I type, so that I can start from any of them.
91. As an Account, I want to set how many shared Channels a candidate needs, so that I control how strict the match is.
92. As an Account, I want each of them to add a column with the shared count and a sort weighted against how connected the candidate is overall, so that giants do not win by size.
93. As an Account, I want "Why it's here" to name a few of the shared Channels, so that I can check the match.
94. As an Account, I want to be told that Shared children work only from Channels somebody follows, so that an empty result does not look like a bug.

### Viewing as another Account, and access

95. As an Owner viewing as another Account, I want to browse the Directory as that Account sees it, so that I can help with what they see.
96. As an Owner viewing as another Account, I want Follow and Dismissal refused unless the session is elevated, so that read-only View-as stays read-only.
97. As an Operator, I want every approved Account to use the Directory with no extra Permission, so that I do not grant one by hand.
98. As an Account awaiting approval, I want the Directory refused like every other data tab, so that approval keeps meaning what it means.
99. As an Operator, I want the database container's shared memory raised, so that large parallel queries stop failing on staging.

## Implementation Decisions

- **Six deep modules**: the database's shared memory (an operations change); the Dismissal (a rename); the citation pairs (ADR-028); the search index (ADR-027); the Directory read model behind one endpoint family; the Directory tab. The tickets cut across them as vertical slices (see Further Notes), so each module arrives with the first ticket that needs it.
- **Dismissal.** One per Account, shared by Discovery reports and the Directory. Discover's dismissal table is renamed to match the glossary, along with its model and service and every inventory that lists it: the tenancy seam, the export omissions (a Dismissal is deliberately not exported, and keeps that reason) and the test cleanup inventory. Discover's behaviour and wire contract do not change. Follow stays withheld on a dismissed Channel.
- **Citation pairs (ADR-028).** One row per distinct citing Channel and cited Channel with its Reference count, and per handle the number of distinct Channels it is cited by and cites. Written by the References writer in the transaction that inserts References, from the rows it reports as new; a pair that did not exist raises its two counts by one. Keyed by handle, not by Directory entry. References are permanent, so nothing decrements. A first-fill script builds both from the existing References.
- **Search index (ADR-027).** A companion table, one row per live Channel entry, owned by the Directory aggregate as its payload table and scoped corpus: a tsvector of the handle and display name (weight A), the bio (B) and the 8 newest samples capped at 12,000 characters (C), a GIN index with fast update off, and a trigram index over handle and display name. The text search configuration comes from the entry's Language (russian, english, german, arabic; everything else simple). Python normalises text before indexing and before querying: Persian letter variants folded, the zero-width non-joiner turned into a space, Chinese and Japanese runs split into overlapping character pairs. The row is rebuilt in the same transaction as every writer that changes its inputs (a probe result, a metadata sync, a recheck, sample retention), and deleted when the entry stops being a live Channel. An index version lets a recipe change re-index old rows in the background.
- **Search query.** Every word but the last matches whole; the last matches as a prefix from three characters. Each word is tried under every configuration in use and the words are joined with AND. A trigram match on the name is ORed in for typos. Relevance is match strength times the log of subscribers. Snippets are cut in Python, for the rows on the page only, from the same normalised text, highlighting words that start with a matched lexeme.
- **Directory filter.** A tree of Conditions with AND, OR, NOT and parentheses, reusing the shared filter tree: its data model, its text form's grammar, and the picker, facet menu, chip row and sort picker components. The browser sends the tree; only the server evaluates it, as the Post filter already works. The vocabulary is closed and the tree is bounded in depth and size, as the Post filter's is.
- **Conditions.** Language (include, exclude, only); bounds on subscribers, Reach, posts per week, forwarded share, days since last post, days since the Directory found it, photos, videos, files and links, each with "no value"; has a profile photo; cited by at least N Channels; cites at least N Channels; cited by @handle and cites @handle (one or more handles); cited by the selected Channels (count, optional window in days); Followed; Dismissed; Followable; and later Shared parents with and Shared children with. Every Reference Condition takes optional Reference kinds. Every Condition can be negated. "Followable" reads the Directory entry's followability verdict.
- **The opening view** is the filter `not followed and not dismissed and followable`, sorted by "cited by the selected Channels", falling back to Reach with a hint when no Channels are selected.
- **"Cited by the selected Channels"** counts distinct selected Channels whose Posts make a Reference to the Channel, over all time unless a window is set. The selection includes the Hidden selection. It is not the Scope: the Analysis window and the Post selection do not apply. The browser sends the selected handles; the server counts live from the References by source, which measured under half a second on staging for every follow at once.
- **The read endpoint family** lives in the Directory route module and takes the Directory filter, the search (text, fields, snippets on or off), the sort and its direction, the page, and the selected Channels for the Conditions that use them. It returns a light list: per row the Directory entry's measures, cited-by and cites counts, the selected-Channels count and its latest time, Followed and Dismissed flags, and the search snippets. Never the bio or samples, which the detail reads. It also returns the total and the Language counts for the view without its Language Condition. Totals are estimates when no search and no Condition beyond the opening view's three (Followed, Dismissed, Followable, which barely narrow it) is on, exact otherwise; totals and Language counts are cached per Account and view for a few minutes, and a Dismissal drops that Account's cache. Separate operations return a measure's distribution for the bound editor and a count-only preview.
- **Because the filter travels in a request body, the list operation is a POST.** It is declared read-only in View-as's inventory, as the Posts tab's feed is, so a View-as session can browse while Follow and Dismissal stay refused unless elevated. Every response model is declared and closed; the routes carry the approval gate and the auth dependency, and the account-isolation probe covers them with two Accounts.
- **Picking the page first.** The page is chosen from the Directory entry and the search index alone unless a Condition or the sort reads citation counts or the selected-Channels count; those are then joined to the page's rows only. That kept the unfiltered page well under a second in the prototype.
- **No parallel workers are assumed.** The database's shared memory is raised as its own change, ahead of this work.
- **Detail.** The existing route that returns a Directory entry's samples already returns them whole with View counts. It gains each sample's Links, which carry no position in the text, so the panel turns visible handles and addresses into links and lists the rest under the Post; the time the sample was captured; and whether the Post carries media, read from its media kinds rather than from the presence of a media block, which nearly every sample has. A neighbours operation returns the Channels citing it most and those it cites most, from the citation pairs, with names.
- **Follow from the Directory** uses the existing bulk follow job, single or many, and records as discovered-via the newest Reference from the selected Channels to that Channel when one exists.
- **The tab.** A new Closable tab, open at most once, called Directory. The filter bar holds the search box with its field toggles and "show matches", the facet buttons, a Filters button opening the Condition list, the sort picker with direction, and a Columns menu; active Conditions show as chips that reopen their editor. The table, the bulk bar and the detail panel follow the prototype's variant E. Undo toasts stay up for ten seconds.
- **State.** The Directory filter, search, sort and page live in the URL as one Directory filter parameter in the shared text form plus search and sort parameters; the last view is also remembered per Account in browser storage through the scoped storage, and a tab opened without them adopts it. The open panel and hidden columns are per browser only.
- **Shared parents and Shared children** read the citation pairs. Each has its own picks, from the selected Channels, every Follow, or typed handles, and its own minimum shared count, defaulting to 2; when both are on, a Channel must pass both; sources citing more than 3,000 Channels, and targets cited by more than 3,000, are skipped as aggregators. Each adds a count column and a sort on the count weighed against the candidate's overall degree, and a line in "Why it's here".
- **Every new table is placed in the repo's inventories.** The search rows, the citation pairs and the citation counts are corpus-scoped in the tenancy seam, listed in the test cleanup inventory, and omitted from export with a reason: each is derived, and rebuilt from the Directory or the References. The renamed Dismissal table keeps its tenancy scope and its export omission, with its reason, under the new name.
- **Service kinds.** The search rows are the Directory aggregate's payload. The citation pairs and counts are the References aggregate's payload, with the References writer their sole writer. The Directory list, detail, neighbours, distribution and count reads form one read model.
- **Responses reach the frontend through the generated client**, per the two-client split; nothing on these routes returns an open dictionary.
- **Columns.** Hiding a column is per browser and per Account, and clearing the filter does not reset it.
- **Prototype snippet: the two rankings** the prototype measured to behave well (from `proto_find_api.py`, trimmed to the decision):

  ```
  relevance  = text_rank(name A, bio B, posts C) * ln(10 + subscribers)
  shared     = shared_count / sqrt(degree(candidate) * count(picks' Citing Channels or cited Channels))
  ```

- **Glossary.** The Closable tab entry gains the Directory tab.

## Testing Decisions

- **A good test asserts what an Account can observe** through the highest seam available, never the shape of a query or a private helper. Data is set up through the real write paths (recording a probe result, writing References), never by inserting index or count rows directly, so a writer that forgets the index fails the test.
- **Main seam: the Directory HTTP API**, in pytest against the test database with two live Accounts, each with its own Follows, selected Channels and Dismissals, over one small shared corpus of Directory entries, samples and References laid out in a table at the top of the module. It covers every Condition, negation and nesting, the opening view, the Reach fallback, the search box (a Russian word form, a Persian letter variant, a Chinese word inside a run, a typo in a name, field limits, the prefix rule), snippets on and off, every sort, estimated and exact totals, Language counts, the distribution and count-preview operations, Dismissal visibility in both Accounts and in Discover, and View-as refusals. Prior art: the Post filter tree's end-to-end API test, which uses the same two-account, table-of-rows shape and lists the mutations it was watched to fail on.
- **Writer seams, existing:** after every writer that changes a search row's inputs, the stored row equals a fresh rebuild; after the References writer runs, the citation counts equal a fresh aggregation over the References. Prior art: the Directory statistics write-path guard.
- **The Directory filter's text form**, as a pure library: text parses and prints back unchanged, malformed text is refused, and the vocabulary is closed. Prior art: the Post filter's and Channel filter's text-form tests.
- **One Playwright journey with a mocked API**: open the tab, add Conditions through the picker, see the URL change and survive a reload, open a shared link, pick rows, confirm a bulk follow of five, dismiss and undo. Prior art: the Discover Playwright spec. It runs serially, as every Playwright spec here does.
- **Component render tests** for every new branching component, which the frontend CRAP ratchet requires: at least the bound editor, the bulk bar and the detail panel's sample list. Test files are type-checked separately from the build, as CI does.
- **Repository guards come along, not new seams:** route inventory, route module hygiene, account isolation (every new operation probed with two Accounts), the approval gate, View-as's inventory, service kinds, the tenancy seam's table classification, the test cleanup inventory and the export inventory. Each guard is watched to fail once before it is trusted.

## Out of Scope

- Semantic search with embeddings. It comes later as a second ranked list merged with keyword results, with its own ADR superseding ADR-005.
- A separate search service, ParadeDB, PGroonga or pg_bigm.
- Probing handles that have no followability verdict yet. Discover's recheck stays the way to probe them.
- Replacing or merging Discover. The two tabs coexist; revisit after the Directory has real use.
- The prototype's reference graph view (variant G) and "walk from Channel to Channel".
- A "Rising" signal (References in the last 7 days against the 7 before) and an engagement measure (View counts against subscribers). Both were proposed and not yet decided.
- Keyboard triage of rows.
- Saved, named views beyond the URL.
- Topic labels for Channels.
- Any change to how the Directory is filled, probed or refreshed, or to how References are extracted.
- A Permission for the tab: every approved Account can use it.

## Further Notes

- The prototype is the primary source: branch `prototype/directory-tab` (variant E, with B and C folded in) and its handoff `.scratch/channel-find/prototype.md`. Its throwaway API read staging live as the `proto` role. None of its code is to be promoted as is.
- The prototype measured on staging: search over 318K Channels in 0.2 to 2.7 s including a ~200 ms tunnel; the unfiltered page in 0.24 s of database time with counts cached; "cited by every follow in the last 14 days" in 0.28 s; Shared parents across 333 follows in 1.4 s. A parallel hash join over References overflowed the database container's 64 MB shared memory and failed with "could not resize shared memory segment".
- The prototype called Reach "average views per post"; the glossary defines it as the median Settled View count of recent Posts, and the tab must say so.
- A plain @mention is stored as both a mention and a link Reference. Every count here is in distinct Citing Channels or distinct Posts, never in Reference rows.
- The Directory keeps growing while it is being read; totals that move by one or two between two reads are expected.
- Tickets, as vertical slices (`issues/`): DIR-01 shared memory (ready for a human, because it restarts staging's database) and DIR-02 browse the Directory start at once; DIR-03 read a Channel and DIR-04 search follow DIR-02; DIR-05 who cites whom and DIR-06 Dismissal follow DIR-03; DIR-07 Shared parents and Shared children follows DIR-05. This replaces the layered order agreed during grilling, which put every table before the endpoint.
