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

**Context pointers:** spec `../spec.md` (Implementation Decisions: Logs on
the server, Logs spread), `../prototype.md`. Only the bar was prototyped, and
browser-side; the server filter and the spread are new:

- [LogFilterBar.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/logs/LogFilterBar.tsx): the Logged bar on `TimeBoundBar`; [filters.ts](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/lib/logs/filters.ts): the browser-side `matchesWhen`, which this ticket removes rather than ports.
- Today's code it changes: the log list route (one route serves every log type) and its service, where the text search already runs in SQL, the logs query hook, and the log filters' inclusive-day rule.
- Model for the spread read: the Posts window histogram (`window_histogram` in the Posts service, the Analysis window chart), binned by the server over an extent.
- Prior-art tests: `test_stats_logs.py`, `test_log_list_payload_cost.py`, `lib/logs/filters.test.ts`, `LogPanels.test.tsx`.
- Regenerate the generated client after the schema change.

- [ ] Each log list endpoint takes an optional Time bound (`mode`, `start`, `end`, either end open) and applies it in SQL as `[start, end)`, a Live end relative to now, before paging.
- [ ] The browser stops filtering logs by time; the two calendar-day inputs and their inclusive-end rule are gone.
- [ ] The Logged bar is the shared collapsed line and popover with open ends and no ahead; an empty bound reads "Any time"; clearing all filters clears it.
- [ ] A server read draws when a log's entries were logged, with the shared zoom, keeping its scale when zoomed; clicking a bar sets a Fixed bound over it.
- [ ] The generated client is regenerated; Playwright mocks of the touched log routes are updated; both typechecks pass.
- [ ] API tests: a bound reaches entries older than the first page, each end open, Live and Fixed; the spread read with and without a zoomed range. Render tests: the bar emits the bound and the spread zooms. Each new guard is mutation-tested.
