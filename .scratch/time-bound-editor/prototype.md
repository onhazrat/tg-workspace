# One time editor prototype

Code: [`prototype/time-bound-editor` @ 10b8c6af](https://github.com/onhazrat/tg-workspace/tree/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19).
The editor pieces are `frontend/src/components/time-bound-prototype/`; the
prototype API is `backend/scripts/proto_time_bound_api.py`.

Status: resolved

Built 2026-10-20 to answer: does one editor, the Posts tab's Analysis window
editor, work for every time filter in the app without changing how the Posts
tab looks or behaves? It did; the answer is ADR-033 and
`docs/time-bound-editor-plan.md`.

## Variants (`?variant=`, every tab)

| Key | Idea |
|---|---|
| 0 | `main`, unchanged |
| 1 | One time editor: Directory Time bounds, Cited by your channels, seven Channel moments and Logs on the Posts editor; zoom on every spread; a symbol on every Filters menu row; a spread on the Channel moments |

The pink bar at the bottom switches variants (Alt+← / Alt+→). The variant is
read app-wide through a context that defaults to `0`, so anything outside the
provider, and every existing test, sees `main`.

## What is real and what is stubbed

- The frontend is the app itself, run locally, with `/api` proxied to a
  deployment's real API. Writes (Follow, tag, dismiss) are real.
- The changed reads (Directory `list`, `count`, `handles`, `distribution`,
  `why`, and `/posts/value-histogram`) go to the prototype API: this branch's
  real Directory and Posts routers served standalone against the deployment's
  database through a read-only role, never mounted in the real API. Setup is
  `docs/agents/prototyping-with-live-data.md`.
- The Logs Time bound filters in the browser over the newest page; the server
  side is TB-05.
- No tests were written. `AnalysisWindowControl.test.tsx` and every existing
  unit test passed unedited throughout.

## Where each ticket's answer lives (at 10b8c6af)

| Ticket | Prototype files |
|---|---|
| TB-01 editor core | `components/AnalysisWindowControl.tsx` (`WindowEditorSource`, `WindowEditorSourceContext`, `WindowEditor` with `noValue`, `WindowOverlay`, `ZoomControls`); `components/time-bound-prototype/TimeBoundEditor.tsx` (`useTimeBoundSource`, `TimeBoundEditor`, `TimeBoundBar`, `timeBoundSummary`, `resolveTimeBound`, `inTimeBound`) |
| TB-01 one text form | `lib/directory/directory-filter.ts` (exported `END`, `endValue`, `instantText`, `offsetText`, `timeBoundWords`); their use in `lib/channels/channel-filter.ts` |
| TB-01 Directory Time bound | `components/directory/DirectoryTimeEditor.tsx` (the variant-1 branch) |
| TB-02 Cited by your channels | backend `schemas/directory.py` (`DirectoryMineCondition`, `DirectoryWhyRequest`), `services/directory_reads.py` (`MineCond.when`, `_references`, `why_its_here`), `api/routes/data/directory.py`; frontend `components/directory/DirectoryConditionEditors.tsx` (`MineEditorV1`), `lib/directory/directory-filter.ts` (`mine` label, text, parse), `lib/directory/directory-panel.ts` (`mineBound`), `components/DirectoryView.tsx` and `components/directory/DirectoryPanel.tsx` (Why request and wording) |
| TB-03 Channel Time bounds | `lib/channels/channel-moments.ts`; `lib/channels/channel-filter.ts` (`TimeCond`, evaluation, label, text form); `components/channel-grid/ChannelTimeEditor.tsx` (editor, browser-drawn spread, minute rounding); `components/channel-grid/ChannelMetricMenu.tsx` and `ChannelConditionPicker.tsx` (Times section, day counts hidden) |
| TB-05 Logs Time bound (browser-side; TB-05 moves it to the server) | `lib/logs/filters.ts` (`timeBound`, `matchesWhen`); `components/logs/LogFilterBar.tsx` (`TimeBoundBar`, label Logged) |
| TB-04 spread zoom | `components/time-bound-prototype/zoom.tsx` (`spreadZoom`, `boundFocus`, `SpreadZoomBar`, `momentText`); `components/directory/DirectoryBoundEditor.tsx` (`Spread` with `zoom`); `components/DirectoryView.tsx` (`lo`/`hi` in the distribution query); `components/channel-grid/ChannelMetricEditor.tsx`; `components/PostFilterControls.tsx` and `hooks/usePostsView.ts` (value histogram range); backend `services/directory_reads.py` (`distribution` zoom), `services/posts.py` (`value_histogram` zoom), their schemas and routes |
| TB-03 menu symbols | `components/time-bound-prototype/MenuRowLabel.tsx`; `components/PostFilterControls.tsx` (`PostFiltersMenu`); `components/channel-grid/ChannelMetricMenu.tsx`; `components/channel-grid/ChannelFilterRow.tsx` (`#` chips) |
| TB-05 Logs on the server, Logs spread | not prototyped |

Paths are under `frontend/src/` unless they say backend.

## What the prototype got wrong, and the spec corrects

- Channel moment keys were `last_updated`, `sync_start`, `oldest_post`,
  `next_regular_sync`, `next_dynamic_sync`; the spec ends every key in `_at`.
- A Live Channel bound used `Date.now()` at filter time and went stale while
  the tab stayed open; the spec re-filters on the Scope's minute tick.
- The Posts value histogram picked log or linear per zoomed range, so a zoomed
  Views chart changed shape; the spec keeps the whole spread's scale.
- The Cited-by API kept `days` beside the new fields so variant 0 still worked;
  the spec removes `days`.
- The day counts were only hidden from the menus in variant 1; the spec
  removes them.

## Findings

- `?variant=1` reads as a number in TanStack Router's search parsing.
- No value as a separate button sat alone on its own row; as the mode switch's
  third segment it reads as one choice.
- "Why it's here" in the bar's summary ("in Live · 14d ago → open") read as
  code; the chip's words read as a sentence.
- A clicked Channels bar first counted one fewer than the bar: the newest
  value sat on the bar's end, which a bound excludes. Rounding out to whole
  minutes fixed it.
- On staging the Followed moment's tallest bar held 204 Channels followed in
  one bulk on one day; zoom is what makes such a spread readable.
