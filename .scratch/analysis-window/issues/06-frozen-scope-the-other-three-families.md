# AW-06: Frozen Scope, the other three families

**What to build:** Move Chat, Tag run and Discovery report onto the frozen-Scope
value object AW-05 established, so Artifact kind stops changing temporal meaning.

**Blocked by:** AW-05

**Status:** done

## The rule this ticket makes true

All four Artifact families freeze Scope the same way, through one contract. A
filter added or changed later cannot reach only some producers.

## Acceptance criteria

- [x] Chat, Tag run and Discovery report each persist the same validated frozen-Scope value at creation, through the same submission-time resolution.
- [x] Each of their read models returns that value and derives Duration from the exact boundaries.
- [x] A later update to any of the three cannot replace its frozen Scope.
- [x] The unified History read and each detail read expose one Scope shape across all four kinds.
- [x] A parameterized test matrix covers all four families: each creation path freezes submission-time boundaries and the complete filter set before a simulated queue delay, each read returns the same immutable Scope, and a later write cannot replace it.
- [x] Any per-kind scope representation that would now duplicate the shared one is identified for removal in AW-07.
- [x] The generated API client is regenerated.

## What landed

Two submission doors and one conversion.

`POST /data/chat-sessions` and `POST /data/tag-runs` are `submit_summary`'s
twins, and both needed to exist rather than being nice to have. A chat writes
its whole session back on **every turn** and a tag run is written at least
twice, so these were the two families where the recorded window was whichever
one the *last* write happened to land in. Both open the row empty, before any
token is spent, and the writes afterwards fill in what the run produced.

Discover needed no new route. `POST /data/discover/reports` was already the one
place a report is created, and `DiscoverCandidatesRequest` already carried every
field a `ScopeSubmission` does under the same names — it is `PostScopeRequest`
plus the cap mode, the seed and the explicit selection, which is what a
submission is. So it converts (`to_scope_submission`) rather than growing a
second spelling. What changed is *when*: the route freezes once and hands the
value to `create_report`, where before the route resolved a window and the
service wrote what the route had resolved.

`FrozenScope` grew `stored()` / `stored_posts()` / `from_stored()`. Four
families splitting one value across two columns is four copies of the same two
lines, and one of them was already subtle: drop `duration_minutes` from the
exclusion and a derived number becomes a third stored fact.

**Where `scope_posts` lives follows each table's own corpus split**, not one
rule imposed across three. A chat keeps its transcript in
`tg_chat_session_payloads`, so the refs go there. A tag run and a report keep
their corpus on the base row and stay out of the list projection by column
selection, so the refs go on the row and join `HEAVY_TAG_RUN_COLUMNS` /
`HEAVY_REPORT_COLUMNS`.

`ArtifactBase.scope` is the unified read. History is the one screen that lists
all four kinds, so it is the one place "kind does not change temporal meaning"
is either true or visibly false — each leg of the union now selects one column
holding one shape.

### The successor, which AW-05 left for this ticket to shape

It is **`successorOf` on `SummarySubmitRequest`, standing in place of `scope`**,
not a route of its own. The question it answers is "where did this submission's
Scope come from", which belongs to the submission contract the other three
families just joined; a second route would have been a second way to open a
Summary, with its own id handling, its own 409 and its own drift. A validator
requires exactly one of the two, because both would need a precedence rule over
*which Posts did this use* and neither is the Scope-less submission AW-05 made
impossible.

`services/summaries.py::successor_scope` is now the only copy of the three
lines. `jobs/auto_summary.py` calls it and so does the submission, so the
browser and the worker cannot record different things for one chain. The window
it produces ends in the future by design and is never clamped: `end_date` is
what the *next* successor reads for both its start and its duration, so a
clamped link shortens every run after it and the chain decays.

A **re-run** (`generateBackgroundSummary(s, false)`) is not a successor — it is
the same window again — so it states that window instead of deriving one, and
goes through ordinary validation. Re-running a window that has not finished
elapsing is now refused rather than silently summarised in part. It previously
took the `PUT` path and recorded no Scope at all.

### Identified for removal in AW-07

Each of these is the per-kind representation the shared `scope` column now
supersedes. All are kept in step at creation and never written again, so they
cannot diverge before AW-07 drops them.

| Where | What | Why it is still there |
|---|---|---|
| `tg_summaries`, `tg_chat_sessions`, `tg_tag_runs`, `tg_discover_reports` | `channels`, `start_date`, `end_date` columns | the History union and every list projection still read them |
| `tg_discover_reports` | `keyword`, `forwarded`, `media`, `max_per_channel`, `max_per_channel_mode`, `seed`, `scoped_post_count` columns | the whole filter set, stored twice; `_scope` reconstructs from them for a legacy row |
| `DiscoverReportScopeResponse` | `startDate` / `endDate` fields | the Discover scope card renders them until AW-08 moves it to `start`/`end` |
| `SummaryResponse` and the three siblings | `startDate` / `endDate` / `channels` fields | same, for the four result tabs |

`DiscoverReportScopeResponse.signals` is **not** on that list and stays: it
picks which kinds of signal a report describes, not which Posts it reads, so it
is a report input rather than part of Scope.

### Not done, deliberately

A semantic **chat** submits no explicit Post selection. It ranks Posts per
*turn*, against the question being asked, so there is no session-wide selection
to freeze; the session's Scope is the window and filters that ranking ran
inside, and `scopedPostCount: null` says exactly that. The API accepts one —
the contract is the same for all four — this caller simply has none to send.

## Notes

Discover reports already store the full filter set while Summaries, Chats and Tag
runs store channels and dates only. This ticket sets the shape all four will
share; AW-06 moves the remaining three onto it.
