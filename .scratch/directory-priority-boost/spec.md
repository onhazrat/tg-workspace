# Directory: Priority boost, and sort and filter on every column

Status: ready-for-agent

Ticket prefix: `DPF`.

Settled in one grilling session on 2026-10-17. The decision record is
`docs/directory-priority-boost-and-sort-plan.md`; this spec is written from it.
The terms **Priority boost** and **Time bound** are defined in `CONTEXT.md`.

## Problem Statement

The Operator cannot say which Directory entries matter more to fetch. The
order the Directory fetches entries in is decided entirely by whoever enqueued
them: a report's rank, a harvest, a scheduled refresh, a recheck. Every entry
in one band ties and falls to alphabetical order. An Operator who wants the
refresh of twenty Persian news Channels to come before the other 50,000
refreshes has no way to say so short of psql, and anything written into the
drain order by hand is overwritten by the next fetch.

The Operator also cannot look at what the Directory knows about entries that
are not Channels. Bots, groups, user accounts and every handle that has not
been fetched yet are hidden from everyone, so a handle that keeps failing, or a
batch that never resolved, is invisible from the Directory tab.

And the Directory tab can show 27 columns but sort and filter on only twelve of
them. An Account can see a Channel's sample size or its followability verdict
and cannot sort by either. An Operator can see the attempts, the last error and
when an entry is due again and cannot ask "every entry due in the next two
days" or "every entry whose last error mentions a timeout". The two time
measures that can be filtered count days back from now only, so they cannot
name a fixed period, and nothing at all can be asked of the four timestamps an
Operator uses to follow the fetch queue.

## Solution

Every Directory entry carries a **Priority boost**, zero by default. An
Operator sets it from the Directory tab, for the Ticked entries at once (set
every one to a value, or add a value to each) or for one entry from its panel.
A positive boost fetches the entry sooner and a negative one later, relative to
the entries waiting beside it. The boost stays until an Operator changes it,
whatever the fetches in between find. The table can show the boost and the
effective priority it produces, and sort by either, so the Operator sees the
order the Directory will actually fetch in.

An Operator sees every Directory entry, of every kind, Channels or not. The tab
still opens on followable entries, so nothing changes until the Operator turns
that switch off.

Every column the Directory tab can show can be sorted and filtered. Numbers get
the bound they already have. The verdict and the kind get an "is" Condition.
The last error gets a "contains" Condition. Every moment (the last Post, when
the Directory found the entry, when it was last checked, attempted, retried and
when it is due again) gets a **Time bound**, which is Live or Fixed like the
Posts tab's Analysis window but may leave either end open, and can look ahead
as well as back. Moments are shown and picked in the viewer's time zone.

A column the viewer may not see cannot be sorted or filtered by either.

## User Stories

### Setting a Priority boost

1. As an Operator, I want every Directory entry to start with a Priority boost of zero, so that adding the feature changes no fetch order on its own.
2. As an Operator, I want to set the Priority boost of all Ticked entries to one value in a single action, so that a batch I filtered for is reordered at once.
3. As an Operator, I want to add a value to the Priority boost of all Ticked entries in a single action, so that I can nudge a batch whose entries already carry different boosts.
4. As an Operator, I want to set a negative boost, so that I can push entries I care little about behind the rest of their band.
5. As an Operator, I want to set one entry's Priority boost from its panel, so that I can adjust a single Channel without ticking it.
6. As an Operator, I want a boost of +1 on some entries to put them ahead of every other entry in the same band and behind every entry in a better band, so that I can reorder within a band without thinking about band numbers.
7. As an Operator, I want a large enough boost to move an entry ahead of a manual recheck, so that the arithmetic is the whole rule and I never have to remember an exception.
8. As an Operator, I want the boost to survive every fetch, refresh, recheck and sync of the entry, so that a standing decision does not quietly disappear.
9. As an Operator, I want a boost outside plus or minus one billion refused with an explanation, so that a typo cannot break the queue.
10. As an Operator, I want an "add" that would push any Ticked entry past that range refused for the whole batch, so that I never end up with half a batch changed.
11. As an Operator, I want the bulk boost actions offered only while entries are Ticked, so that I cannot apply a boost to nothing.
12. As an Operator, I want the table to update after I set a boost, so that I can see the result without reloading.
13. As an Account without the Permission, I want never to see the boost controls, so that the tab does not offer me something I cannot do.
14. As an Account without the Permission, I want a direct request to change a boost refused, so that the Directory's fetch order stays the Operator's decision.
15. As an Owner in a View-as session, I want changing a boost refused, so that viewing as somebody never changes deployment-wide fetch order.

### Seeing the queue order

16. As an Operator, I want a Priority boost column, so that I can see which entries carry a boost.
17. As an Operator, I want an effective priority column, so that I can see the number the Directory actually fetches by.
18. As an Operator, I want to sort by effective priority, so that the table reads in the order the Directory will fetch.
19. As an Operator, I want to filter by Priority boost, so that I can list every entry I have boosted.
20. As an Account without the Permission, I want the boost and effective priority columns absent from my catalogue, as the raw priority already is.

### Seeing every kind of entry

21. As an Operator, I want to see bots, groups, user accounts and entries not yet fetched in the Directory list, so that I can follow what the Directory knows about every handle.
22. As an Operator, I want the tab to open on followable entries as it does today, so that the extra rows appear only when I ask for them.
23. As an Operator, I want to filter by kind, so that I can list only the bots or only the unfetched handles.
24. As an Operator, I want to find an unlisted entry by its handle or name, so that I can look up one I know about.
25. As an Operator, I want to know that bio and sample-Post search only reach Channels, so that an empty search result over bots does not mislead me.
26. As an Account without the Permission, I want to keep seeing Channels only, so that my Directory is unchanged.
27. As an Operator, I want the count and the histograms to agree with the wider list I see, so that the numbers describe the rows on screen.

### Sorting by every column

28. As an Account, I want to sort by any column the Directory tab shows me, so that I can rank Channels by whatever I am judging them on.
29. As an Account, I want to sort by sample size, so that I can prefer entries whose statistics rest on more Posts.
30. As an Account, I want to sort by Language, so that Channels of one Language sit together.
31. As an Account, I want to sort by verdict and by followability, so that dead entries group together.
32. As an Account, I want to sort by bio, so that every sort I am offered works the same way.
33. As an Account, I want to sort by when an entry was last checked, so that I can see the freshest answers first.
34. As an Account, I want clicking a column header to sort by it, as the existing sortable headers do.
35. As an Operator, I want to sort by attempts, last error, last attempt, retry time, raw priority, chat id and latest Post id, so that I can work through the fetch queue's bookkeeping.
36. As an Account without the Permission, I want a sort on an internal column refused, so that the order of rows does not reveal a value I cannot see.

### Filtering by every column

37. As an Account, I want to bound sample size, so that I can hide entries whose statistics rest on two Posts.
38. As an Account, I want an "is" Condition on the verdict, so that I can list the entries found unavailable.
39. As an Operator, I want an "is" Condition on the kind, combined with OR through the filter grammar, so that I can list bots or groups.
40. As an Operator, I want a case-insensitive "contains" Condition on the last error, so that I can find every entry failing the same way.
41. As an Operator, I want to bound attempts, so that I can find the entries that keep failing.
42. As an Operator, I want to find one entry by its chat id with an exact bound, so that I can trace a renamed Channel.
43. As an Account, I want an entry with no value to fail a bound, and the existing "has no value" switch to ask for those entries, as every bound does today.
44. As an Account without the Permission, I want a Condition on an internal column refused, so that filtering cannot leak a value I cannot see one row at a time.
45. As an Account, I want the filter text to accept every new Condition, so that I can type it as well as build it.

### Time bounds

46. As an Account, I want a Time bound on when an entry last posted, so that I can find Channels active in a period.
47. As an Account, I want a Time bound on when the Directory found an entry, so that I can see what arrived this week.
48. As an Account, I want a Time bound on when an entry was last checked, so that I can trust or distrust its numbers.
49. As an Operator, I want Time bounds on the last attempt, the retry time and the refresh due time, so that I can follow the fetch queue.
50. As an Account, I want to switch a Time bound between Live and Fixed, as the Posts tab's Analysis window switches, so that the control works the way I already know.
51. As an Account, I want a Live Time bound to keep moving with the current time, so that "posted in the last 7 days" still means that tomorrow.
52. As an Account, I want a Fixed Time bound to name exact instants, so that a period I chose stays put.
53. As an Account, I want to leave either end of a Time bound open, so that "since the 1st" and "before the 1st" are each one Condition.
54. As an Operator, I want a Live end that points ahead, so that "due within the next 2 days" is one Condition.
55. As an Operator, I want a Live end that points back and one that points ahead in the same Time bound, so that "from a day ago to a day from now" is expressible.
56. As an Account, I want to see and pick moments in my own time zone, so that I never convert from UTC in my head.
57. As an Account, I want a Fixed Time bound in a shared link to name the same instant for a reader in another time zone, so that a link means one thing.
58. As an Account, I want a Live Time bound in a shared link to resolve against the server's clock, so that a viewer with a wrong clock sees the same rows.
59. As an Account, I want a Time bound to include its start and exclude its end, as the Analysis window does, so that two adjacent bounds never count a moment twice.
60. As an Account, I want a histogram in every Time bound's editor, as the two day measures have today, so that I can see where entries fall before I pick a bound.
61. As an Account, I want the chip's label to say the Time bound in words in my time zone, so that I can read the filter at a glance.

### Renamed keys and old links

62. As an Account, I want the last-post and found columns named by their moments, so that every moment's column, sort and Condition reads the same way.
63. As an Operator, I want my stored default columns to keep the last-post and found columns on after the rename, so that the deployment's defaults survive the upgrade.
64. As an Account, I want a link whose filter can no longer be read to open on the opening filter with a dismissible notice saying so, so that I know why my view changed.
65. As an Account, I want a link whose sort can no longer be read to open on the default sort, as an unknown sort does today.
66. As an Account, I want the filter the tab writes into the URL to use only the new syntax, so that the links I share from now on keep working.

## Implementation Decisions

### Schema

- `tg_channel_directory` gains `priority_boost`, an integer, not null, server default `0`, so every existing row reads zero with no backfill.
- It gains `effective_priority`, a stored generated column equal to `priority - priority_boost`.
- The queue index on `(status, priority)` is replaced by one on `(status, effective_priority)`. No other new index: the new sorts are measured on the staging copy first, and staging disk is at 91%.
- `priority` stays int4. The boost is bounded to plus or minus 1,000,000,000 so the difference cannot overflow.
- One migration does the columns, the index swap and the rewrite of the stored Directory column-defaults row (`last_post_days` becomes `last_post_at`, `found_days` becomes `created_at`).

### The probe queue (the Directory aggregate)

- The dequeue orders by effective priority, then handle. Its WHERE is unchanged.
- No writer of `priority` touches `priority_boost`: the conclusive-probe reschedule, the refresh, the recheck, the enqueue and the sync metadata path all leave it alone. The sync path's test for `priority == RECHECK_PRIORITY` keeps reading the raw priority, which is why the boost is a separate column.
- New aggregate writers: set the boost of a list of handles to a value, and add a value to the boost of a list of handles. The add is checked for every handle before any row changes, and a result outside the range refuses the whole call. Both write only `priority_boost` and do not re-index search, since the boost is not searched.
- A boost may beat `RECHECK_PRIORITY`. That is deliberate (plain arithmetic), and the constant's docstring should say so.

### API contract

- One new route on the Directory family for the bulk and the single-entry change, taking a list of handles, a mode (`set` or `add`) and a value, and answering how many entries changed. One route rather than two: the panel sends one handle.
- Gated by `DATA_ADMIN`. A View-as session is refused by the existing non-safe-method rule; no allowlist entry.
- The value is validated by the request schema (range for `set`); the `add` range check lives in the aggregate because it depends on each row.
- An unknown handle is skipped and not counted, as the existing refresh and recheck routes treat one.
- `DirectoryColumn` gains `priority_boost`, `effective_priority` and `kind`, and renames `last_post_days` to `last_post_at` and `found_days` to `created_at`. The first two join the internal columns.
- The sort vocabulary becomes every column in the catalogue, plus the existing derived sorts (the "your channels" reads, relevance, shared parents and children).
- New Condition shapes in the filter schema:
  - an "is" Condition on `status` or `kind`, one value per Condition, OR through the tree;
  - a "contains" Condition on `last_error`, case-insensitive;
  - a Time bound: a column (one of the six moments), a mode (`live` or `fixed`), an optional start and an optional end, and the existing "has no value" flag. A Fixed end is a UTC instant. A Live end is a signed offset in ms from the time of the query, negative for the past, ms like every other timestamp on the wire.
- The numeric bound gains `sample_count`, `attempts`, `latest_id`, `telegram_chat_id`, `priority`, `priority_boost` and `effective_priority`.
- A sort or Condition on an internal column from a caller without `DATA_ADMIN` answers 422, the answer an unknown measure already gets.
- A `DATA_ADMIN` caller's list, count and distribution drop the `kind = 'channel'` restriction; everyone else keeps it. The search document table stays Channel-only, so the search box never matches an unlisted entry; the Name Condition does.
- The distribution endpoint learns to bucket a timestamp column, so every Time bound has a histogram. Its response shape for the existing measures does not change.
- Language becomes sortable by code; it was a Condition only.

### Frontend

- The filter grammar gains the "is", "contains" and Time bound forms, and a Fixed end is written into the URL as an ISO UTC instant. The old `last_post_days` and `found_days` forms are removed and no longer parse.
- An unreadable `?dirFilter=` still falls back to the opening filter, and now also shows a dismissible notice. An unknown `?dirSort=` still falls back silently.
- The Time bound editor is its own component with a Live/Fixed toggle in the Analysis window's spirit. It does not reuse the Analysis window control, whose two-ends-required Duration and End gap model does not fit a bound with an open end. It draws a histogram like the existing bound editor.
- The bulk bar gains Set boost and Add boost for `DATA_ADMIN` holders; the entry panel gains a boost field. Both refetch the list on success.
- Every column header in the catalogue becomes sortable.
- The opening filter is unchanged.

## Testing Decisions

A good test drives the feature from its outside: HTTP requests and response bodies on the backend, the aggregate's public functions for queue order, the filter grammar's input and output, and what a component renders from its props. A test must not assert on internal helpers.

Seams, agreed with the user, all already in use:

- **Backend HTTP.** A new boost route test module beside the Directory columns and browse tests, and new cases in those modules, using the API test client with live accounts.
  - The boost route: `set` and `add` change only the named entries; a non-holder is refused; a View-as session is refused; a `set` outside the range is 422; an `add` that would cross it for one handle changes no handle; an unknown handle is skipped.
  - Every catalogue column sorts in both directions and every new Condition narrows, including a Time bound with each end open, a Live end ahead, and a Fixed bound across a time-zone-shaped instant.
  - A sort or Condition on an internal column is 422 for a non-holder.
  - A holder sees non-Channel kinds in the list, the count and the distribution; a non-holder does not.
  - The renamed keys: the old keys are 422; the stored column-defaults row is read with the new keys after migration.
  - Prior art: the Directory columns, browse and search API tests.
- **The probe queue.** New cases in the existing Directory aggregate tests.
  - Dequeue order follows effective priority, including a boost that reorders inside a band and one that beats a recheck.
  - The boost survives a conclusive probe, an inconclusive one, a refresh, a recheck, an enqueue and the sync metadata path.
  - Prior art: the recheck-jumps-the-queue and enqueue-rank tests.
- **Frontend filter grammar.** New cases in the Directory filter tests: every new form parses and serialises round-trip, a Fixed end serialises as ISO UTC whatever the viewer's zone, an open end round-trips, and the old day forms no longer parse.
- **Render tests**, props only, in the existing Directory component tests: the Time bound editor's Live/Fixed toggle, open ends and local-time display; the bulk bar's boost actions present only for a holder; the panel's boost field; the notice on an unreadable filter. These also keep the frontend CRAP ratchet satisfied.
- **Existing guards to update, not new seams:** the account isolation probe inventory (the new route), the route inventory, the permission checks, the Directory Playwright spec's mocked list responses (renamed keys), and the generated client.

## Out of Scope

- Attribution of a boost (who set it, and when). Add it when a second `DATA_ADMIN` holder needs to ask.
- Any effect of the boost on the Directory list's order or visibility.
- Inline editing of a boost in a table cell.
- Search over unlisted entries' bios and sample Posts.
- Indexes for the new sorts, until a staging measurement shows one is slow.
- Reading the old `last_post_days` and `found_days` filter syntax.
- Carrying the boost through export and import; the Directory is not exported.
- A separate Permission for curating the fetch queue.

## Further Notes

- The boost exists as its own column because every fetch rewrites `priority`. Folding the boost into `priority` would be erased on the next probe and would break the sync path's equality test against the recheck priority.
- A boost of +1 on a refresh row moves it ahead of every other refresh and behind every never-fetched handle, because the bands are 500,000 apart and ties fall to the handle.
- The Live/Fixed toggle comes from the Analysis window, but a Time bound is not an Analysis window: it is one Condition among many, either end may be open, and it may look ahead. `CONTEXT.md` keeps the two terms apart.
