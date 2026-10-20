# TB-05: Logs filtered by a Time bound on the server, with a spread

**What to build:** An Account on the Logs tab filters by when entries were
logged with the Posts tab's collapsed line and popover, labelled Logged: Live
or Fixed, open ends, no ahead, to the minute, start included and end excluded,
"Any time" when empty. The bound reaches every entry of that log, not only the
newest page, because the server applies it before paging. The popover shows a
spread of when the log's entries were logged, with zoom, so the Account can
see when failures clustered.

**Blocked by:** TB-01, TB-04.

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (Implementation Decisions: Logs on the
server, Logs spread). The bar and its label were prototyped browser-side
(prototype row "TB-05" in `../prototype.md`, pinned to 10b8c6af); the server
filter and the spread were not. The text search's move into SQL is the model
for the filter.

- [ ] Each log list endpoint takes an optional Time bound (`mode`, `start`, `end`, either end open) and applies it in SQL as `[start, end)`, a Live end relative to now, before paging.
- [ ] The browser stops filtering logs by time; the two calendar-day inputs and their inclusive-end rule are gone.
- [ ] The Logged bar is the shared collapsed line and popover with open ends and no ahead; an empty bound reads "Any time"; clearing all filters clears it.
- [ ] A server read draws when a log's entries were logged, with the shared zoom, keeping its scale when zoomed; clicking a bar sets a Fixed bound over it.
- [ ] The generated client is regenerated; Playwright mocks of the touched log routes are updated; both typechecks pass.
- [ ] API tests: a bound reaches entries older than the first page, each end open, Live and Fixed; the spread read with and without a zoomed range. Render tests: the bar emits the bound and the spread zooms. Each new guard is mutation-tested.
