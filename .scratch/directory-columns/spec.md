# Directory columns

Status: ready-for-agent

Ticket prefix: `DCOL`.

Settled in one grilling session on 2026-10-15. The decision record is
`docs/directory-columns-plan.md`; this spec is written from it.

## Problem Statement

The Directory tab's Columns pill can hide ten columns, and nothing more. A
Directory entry records much more about a Channel than those ten: its four
other Channel counters, its followability verdict, its bio, how big its sample
was, when it was last checked and when it is due again, and the probe queue's
bookkeeping. An Account that wants to judge a Channel by its photo count or its
bio has to open the detail panel row by row. An Operator chasing a probe that
keeps failing cannot see the attempts or the last error at all without psql.

What the table shows by default is also fixed in code. The Operator cannot
decide that a deployment's Accounts should see Photos by default, and an
Account that hides a column has no way to tell what it changed from what it was
given, or to get back to the defaults in one step.

## Solution

The Columns pill lists every column of a Directory entry. The Operator decides
which columns are on by default for the whole deployment. Each Account can set
any column On or Off, or leave it at Default, in which case it follows the
deployment's defaults as they change. The menu shows which columns are default
and which the Account chose, and one button puts everything back to the
defaults.

The probe queue's bookkeeping columns appear only for Accounts holding the
Permission that administers the database, because a probe's last error can
carry a proxy address.

The list read carries only the columns the table shows. Turning on a column the
loaded page does not have reads the page again; turning one off reads nothing.

## User Stories

1. As an Account, I want the Columns menu to list every column the Directory knows about a Channel, so that I can judge a Channel from the table without opening its panel.
2. As an Account, I want Photos, Videos, Files and Links as columns, so that I can compare what kind of content Channels publish side by side.
3. As an Account, I want a Status column, so that I can see whether the Directory's verdict on a Channel is ok, unavailable or still unknown.
4. As an Account, I want a Followable column, so that I can see which Channels I could follow without reading the Follow button on each row.
5. As an Account, I want a Bio column, so that I can scan what Channels say about themselves across a whole page.
6. As an Account, I want a long bio to show as one truncated line with the full text on hover, so that one Channel's bio does not stretch the table.
7. As an Account, I want a Sample size column, so that I can tell how much a Channel's Posts per week and Reach are based on.
8. As an Account, I want a Checked column, so that I can see how recent the Directory's answer about a Channel is.
9. As an Account, I want a Refresh due column, so that I can see when a Channel's entry will next be updated.
10. As an Account, I want the columns I see by default to be the ones the Operator chose, so that a new Account starts with a sensible table.
11. As an Account, I want today's ten columns to stay on by default after this ships, so that my table looks the same as before until I change it.
12. As an Account, I want every new column to be off by default unless the Operator turns it on, so that adding columns does not crowd my table.
13. As an Account, I want to turn a column on or off from the Columns menu, so that the table shows what I care about.
14. As an Account, I want every column to be in one of three states, Default, On or Off, so that a column I never touched keeps following the deployment's defaults.
15. As an Account, I want a column I set On to look different from a column that is on by default, so that I can tell my choices from what I was given.
16. As an Account, I want a per-row control that puts one column back to Default, so that I can undo one choice without undoing the rest.
17. As an Account, I want the Columns menu split into "Default columns" and "More columns", so that I can see at a glance what the defaults are.
18. As an Account, I want the "More columns" section ordered Content, then Probe, then Internals, matching where those columns sit in the table, so that the menu reads like the table.
19. As an Account, I want the pill to show how many columns I set, as "N set", so that I know my table is not the default one.
20. As an Account, I want a "Reset to default columns" button in the menu while I have set anything, so that I can get back to the defaults in one click.
21. As an Account, I want the reset button to be absent when I have set nothing, so that the menu does not offer an action that would do nothing.
22. As an Account, I want my column choices remembered in this browser across reloads, so that I do not set them again every visit.
23. As an Account, I want my column choices kept apart from another Account's in the same browser, so that signing in as somebody else shows their table, not mine.
24. As an Account who hid columns before this shipped, I want those columns to stay hidden, so that the upgrade does not undo my choices.
25. As an Account, I want the menu to say that the Channel, Follow, handle, display name, photo and kind are not columns, so that I do not look for them.
26. As an Account, I want the new columns to be display-only, with headers that do not pretend to sort, so that clicking a header always does what it looks like it does.
27. As an Account, I want Photos, Videos, Files and Links to keep sorting from their headers, because they are already Measures I can sort by.
28. As an Account, I want turning on a column the page does not carry to read the page again, so that the column fills in.
29. As an Account, I want turning off a column to read nothing, so that hiding a column is instant.
30. As an Account, I want the list read to carry only the columns I show, so that a page I load costs no more than what I see.
31. As an Account, I want hiding Cited by, Cites or Yours to make the list read faster, so that hiding an expensive column saves the work behind it as well as its bytes.
32. As an Account sorting or filtering by Cited by, Cites or Yours, I want the sort and filter to still work while the column is hidden, so that hiding a column never changes which rows I get.
33. As an Account, I want a column I never asked for to be absent rather than empty, so that "not measured" and "not requested" never look the same.
34. As an Account, I want Shared parents and Shared children to keep appearing on their own while their Condition is on, so that DIR-07 works as before.
35. As an Account, I want the Columns menu's search to cover the new columns' names and descriptions, so that I can find a column among many.
36. As an Account holding the database administration Permission, I want the Internals columns (Attempts, Last error, Last attempt, Retry after, Priority, Chat id, Latest id), so that I can diagnose a probe without psql.
37. As an Account without that Permission, I want the Internals columns absent from my menu, so that I am not offered columns I cannot see.
38. As the Operator, I want the server to leave the Internals out of the list read for an Account without the Permission, so that a proxy address in a last error never reaches somebody who cannot see the proxy settings.
39. As an Account who lost the Permission, I want a column I had set On that I can no longer see to do no harm, so that my table still loads.
40. As the Operator, I want to make my current column selection the deployment's defaults from the Columns menu, so that I set the defaults by arranging the table the way I want it.
41. As the Operator, I want my own choices cleared back to Default after I make them the defaults, so that my table follows the defaults from then on and the pill stops saying "N set".
42. As an Account, I want a change the Operator makes to the defaults to reach my Default columns, so that I follow the deployment unless I chose otherwise.
43. As an Account, I want a change to the defaults to leave my explicit On and Off choices alone, so that my choices survive the Operator's.
44. As an Account without the Permission, I want no "Make these the defaults" action in my menu, so that I am not offered something I may not do.
45. As an Owner in a View-as session, I want to see the target's columns as the target sees them, so that View-as shows the target's Directory faithfully.
46. As an Owner in a View-as session, I want changing the deployment's defaults refused, so that a View-as session cannot change deployment policy.
47. As the Operator, I want the defaults stored as deployment policy beside the other deployment settings, so that export, import and the settings registry treat them like every other policy.
48. As a frontend developer, I want a column key the server adds or drops to be a compile error, so that the menu and the server cannot drift apart.
49. As a frontend developer, I want an unknown column in a list request to answer 422, so that a typo fails loudly instead of returning a thinner table.

## Implementation Decisions

### Columns

- The column catalogue is every column of a Directory entry except four. Handle, display name and photo URL are already in the Channel cell. Kind is always `channel` in this list.
- Columns sit in the table in this order: today's ten (Lang, Subs, Reach, Posts/wk, Fwd %, Last post, Yours, Cited by, Cites, Found). Then Content (Photos, Videos, Files, Links). Then Probe (Status, Followable, Bio, Sample size, Checked, Refresh due). Then Internals (Attempts, Last error, Last attempt, Retry after, Priority, Chat id, Latest id). Shared parents and Shared children stay outside the catalogue and keep appearing only while their Condition is on.
- The Internals are gated on the existing database administration Permission (`DATA_ADMIN`). A probe's last error is the text of any exception, which can include a proxy URL, and the proxy settings are behind that Permission already. No new Permission is added.
- The new columns are display-only. Photos, Videos, Files and Links already sort as Measures and keep doing so. Bio and Last error render as one truncated line with the full text as a tooltip.

### Deployment defaults

- The defaults are a new deployment-policy key in the app settings table, classified in the settings registry with a reason. Its value names the columns that are on by default. A column it does not name is off.
- With no row stored, today's ten columns are on. This is a code fallback, not a seed migration: same behaviour, and the test suite truncates the app settings table between tests.
- A new column catalogue route, under the data router's Directory family:
  - `GET` answers the columns this caller may see, each with whether it is on by default. Every approved Account may call it. The Internals appear only for a holder of the Permission.
  - `PUT` replaces the defaults. It requires the Permission. It takes the set of column keys that are on by default and refuses an unknown key.
- View-as reads the catalogue as the target. The `PUT` is a write, so a View-as session refuses it unless elevated, and a target holding the Permission is never elevatable, so in practice a View-as session never changes it.
- Labels and descriptions stay in the frontend; the server owns only the set of keys and their defaults.

### Each Account's choices

- An Account's choice for a column is `on`, `off`, or absent, which means Default. The choices are stored per Account per browser through the scoped storage, as a map from column key to `on` or `off`.
- The effective state of a column is the Account's choice when there is one, else the deployment's default.
- The selection is Custom while the map has any entry, even an entry that agrees with the default. The pill badge reads "N set", where N is the number of entries. The reset button in the menu header empties the map and is shown only while it is non-empty.
- The menu has two sections, "Default columns" (default on) and "More columns" (default off), each in table order. A row's checkbox shows the effective state; clicking it always writes an explicit `on` or `off`. A row with an explicit choice carries a marker and a per-row control that removes its entry.
- A holder of the Permission also sees "Make these the defaults for everyone". It `PUT`s the holder's current effective set, then empties the holder's own map.
- The old stored hidden-columns list is read once: each hidden key becomes an explicit `off`, and the old key is removed.
- A frontend pure transform owns this logic. It takes the catalogue, the defaults and the Account's map, and answers the effective set, the Custom count, which columns a list read must request, and whether toggling a column on needs a new read. The old list migration also lives in it.

### The list read

- The list request body gains a required `columns` field: a list of column keys typed as a closed literal union, so the generated client carries the union and the frontend's exhaustive record over it fails to compile on drift. An unknown key answers 422.
- A gated column asked for by an Account without the Permission is dropped silently, not refused.
- The row response declares as required the fields every row needs whatever is shown: handle, display name, photo URL, followed, followable, dismissed, tags, the search match, and the two Shared counts. Every column field is optional and omitted, never `null`, when it was not requested, because `null` already means "not measured". A companion field travels with its column: Reach's estimated flag with Reach, the newest citation time with Yours.
- The row model is not all-optional, so it stays in the generated client under the two-client contract.
- A hidden column skips its work. Cited by, Cites and Yours are aggregates over Post References. When one is not requested and neither the sort nor the filter reads it, the read does not compute it. The sort and the filter keep working on a hidden column.
- The list query's key includes the requested columns. Turning a column on that the loaded page lacks changes the key and reads again. Turning one off does not change the requested set until the next read for another reason (page, filter, sort, search). Until then the hidden field stays in the cache unseen.
- The detail panel's entry read is unchanged.

## Testing Decisions

A good test here drives the feature from its outside. On the backend that means HTTP requests and response bodies. On the frontend it means the pure transform's inputs and outputs and what the menu renders. A test must not assert on internal helper calls. It may capture the SQL sent, because "a hidden column skips its work" is a claim about the database and the codebase already guards claims like it that way.

Three seams, agreed with the user:

- **Backend HTTP.** A new Directory columns test module beside the existing Directory browse tests, using the API test client with live accounts.
  - The catalogue: a holder sees the Internals and a non-holder does not, defaults round-trip, the `PUT` refuses a non-holder and an unknown key, and a View-as session cannot `PUT`.
  - The list: an unrequested column is absent from every row rather than `null`, a requested column is present (`null` where not measured), a gated column is absent for a non-holder even when requested, an unknown key is 422, and sort and filter by a hidden aggregate still order and narrow correctly.
  - The cost claim: with Cited by, Cites and Yours unrequested and not read by the sort or filter, the captured SQL never reads Post References for them.
  - Prior art: the Directory browse and search API tests, and the summary and log list payload cost guards for statement capture.
- **Frontend pure transform.** Unit tests in the style of the Directory view tests.
  - Effective state from defaults and the map, with an explicit choice beating the default.
  - The Custom count, including an entry that agrees with the default.
  - Reset and the per-row return to Default.
  - The one-time migration from the old hidden list.
  - The requested set.
  - Whether a toggle needs a read: on and missing means yes, off means no.
  - A gated column the catalogue does not list never being requested.
- **Columns pill render test.** In the existing Directory bar tests, props only:
  - The two sections and their order.
  - The marker and the per-row control on an explicit choice.
  - The "N set" badge.
  - The reset button present only while Custom.
  - "Make these the defaults" present only when the caller may use it.
  - Search over the new columns.
  - This also keeps the frontend CRAP ratchet satisfied for a new branching component.
- Existing guards to update rather than new seams:
  - The account isolation probe inventory: probe or excuse the two new operations.
  - The route inventory and the permission checks.
  - The settings table split: classify the new key.
  - The View-as inventory.
  - The row projection key-set guard, if one covers the Directory row.
  - Playwright's Directory list mocks: the response shape changes, and only CI Playwright would otherwise catch it.
  - No new Playwright spec.

## Out of Scope

- Sorting by any of the new Probe or Internals columns, and using them as Directory filter Conditions.
- Reordering or resizing columns.
- Storing an Account's column choices on the server or syncing them across devices.
- Showing Internals to anyone without the database administration Permission, or a separate Permission for them.
- Per-Account defaults set by somebody other than the Account itself.
- Changing the detail panel, the Discover tab, or the Channels tab tables.

## Further Notes

- No ADR. Nothing here is hard to reverse, and no new domain term came out of the grilling, so `CONTEXT.md` is unchanged.
- The catalogue route's handler docstring ships in the public client; keep ticket ids in a comment above the decorator.
- Regenerate the client after the schema change, and rebuild the backend before running Playwright against it.
