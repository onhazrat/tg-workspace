# ADR-033: One time editor for every time filter

**Status:** Accepted (2026-10-20); the frozen Analysis window chart superseded by [ADR-037](./ADR-037-one-spread.md). Plan: `docs/time-bound-editor-plan.md`.
Prototype: variant 1 on [`prototype/time-bound-editor` @ 10b8c6af](https://github.com/onhazrat/tg-workspace/tree/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19).

## Context

The app filters by time in five places and edits that time with four
different editors. The Posts tab edits the Analysis window with Live and
Fixed, four fields (Start, End, Duration, End gap) and elapsed shortcuts
(AW-04). The Directory edits a Time bound with its own Live and Fixed fields,
open ends and "ago / from now" selects (DPF). Cited by your channels takes a
whole number of days from preset chips. The Logs tab takes two calendar days,
the last one inclusive. The Channels tab has no time filter at all, only two
day counts ("Days since last update", "Days followed") bounded like numbers.

AW-04 made the Analysis window editor the only editor of the Analysis window,
so two surfaces could not disagree about what Live means. Every other time
filter grew its own editor anyway, each with its own parser, its own idea of
an open end and its own wording.

## Decision

- **One editor.** The Analysis window editor's body (the mode switch, the four
  fields, the elapsed shortcuts) reads and writes through a source. The Scope
  is one source; a Time bound draft is the other. Two wrappers carry it: the
  collapsed line with a popover or bottom sheet (Posts, Logs) and an embedded
  form inside a condition menu (Directory, Channels).
- **The Posts tab's Analysis window editor keeps its look and behaviour.** Its
  code may change so the pieces fit together; its tests are the guard.
- **Every time filter is a Time bound.** Directory moments, Cited by your
  channels (on when the citing Posts were published, in place of `days`),
  seven Channel moments (in place of the two day counts) and the Logs tab. One
  text form writes a Time bound in every filter that lives in a URL.
- **Differences are switches on the one editor**, not separate editors: open
  ends, an End ahead of now (a negative End gap), and No value as a third
  segment of the mode switch.

## Alternatives considered

- **The same look, separate code**: restyle each editor to match. Rejected:
  the editors drift again the first time one of them changes.
- **Two fields everywhere** (Start and End only), dropping Duration and End gap
  from the Posts editor. Rejected: a Live window is a Duration and an End gap,
  and the Posts editor is frozen.
- **Keep the Channels day counts** and put a time editor in front of them.
  Rejected: "days since X ≤ 3" is a Live Time bound written awkwardly.
- **Cited by your channels stays `days` on the server**, with the editor
  limited to whole days. Rejected: one Time bound everywhere is the point, and
  the API has one client.

## Consequences

- A rule change in the editor reaches every time filter at once.
- Old Channels links that bound `days_followed` or `days_since_update` no longer
  parse, and the tab ignores them as it ignores any filter it cannot read.
  Directory links with `mine:14d` keep parsing.
- `days` leaves the Directory API (the Cited by your channels Condition and
  the "Why it's here" request), and the client is regenerated.
- Until the Logs list endpoints take the Time bound, the Logs filter only sees
  the newest page of each log type. The plan moves it to the server.
