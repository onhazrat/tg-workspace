# Spec: The Analysis window

**Status:** ready-for-agent

Implements the accepted decision in `ADR-018: One global Analysis window with
explicit Live and Fixed modes`. The ADR is authoritative if this spec and the
decision record ever appear to disagree.

## Problem Statement

The Posts tab currently presents two timestamps and a row of apparently relative
shortcuts, but every shortcut immediately freezes into an absolute pair. A person
who chooses “24h” cannot tell whether the window will continue to mean the last
24 hours or whether it means the particular 24 hours that happened to be selected
at click time.

The two timestamp fields also hide important behavior. Moving one boundary across
the other silently moves the other boundary, an end displayed as 02:00 does not
say whether 02:00 itself is included, and a future end is silently clamped. Those
repairs make it impossible to predict which Posts will actually be used.

The consequences extend beyond the Posts list. The same Scope feeds Summaries,
Chats, Tag runs and Discovery reports, yet the current Artifact families retain
different subsets of the active filters. Opening an Artifact from History also
replaces the current workspace Scope automatically. A person can inspect an old
result and unknowingly turn a current working window into an old fixed one.

There is therefore no single, explicit answer to three basic questions: whether
the current window moves with time, exactly which instants it contains, and which
complete Scope an Artifact preserves.

## Solution

Give Scope one global **Analysis window**, edited on Posts and represented
compactly everywhere else Scope is used. The Account explicitly chooses **Live**
or **Fixed**; the mode is never inferred from the selected values.

A Live window keeps a fixed Duration and End gap. Both boundaries advance from
the server's current minute, so a window can cover the latest period or can
deliberately stop before it, such as ten hours ago through thirty minutes ago. A
Fixed window keeps exact Start and End instants. Its End gap grows as time passes,
but its boundaries and Duration do not move.

The editor always contains four linked fields: **Start**, **End**, **Duration**
and **End gap**. Every valid change applies immediately according to one visible,
deterministic propagation rule. Incomplete or invalid input remains a draft and
leaves the last valid global Scope untouched.

The application stores and compares UTC timestamps, while every ordinary
interface shows local time without exposing timezone or storage details. The
window is a half-open interval: Start is included and End is excluded. A displayed
Fixed end of 02:00 therefore means the exact instant 02:00:00 and does not include
the rest of that minute.

When an Action is submitted, the server resolves any Live window before queueing
and stores the resulting exact Fixed boundaries with the complete Scope. Every
Artifact shows exact local Start and End plus Duration. Opening an Artifact only
inspects it; a separate **Use this Scope** action deliberately restores its frozen
Scope to the workspace as a Fixed window.

## User Stories

1. As an Account, I want to choose Live or Fixed explicitly, so that similar-looking windows never behave differently because of an inferred mode.
2. As an Account, I want a Live window to advance automatically, so that “the last 24 hours” remains current without repeated manual edits.
3. As an Account, I want a Live window to end before now, so that I can exclude an incomplete or noisy newest period.
4. As an Account, I want a Fixed window to keep both exact boundaries, so that I can repeatedly inspect the same historical slice.
5. As an Account, I want Start, End, Duration and End gap visible together, so that I can understand both boundaries and the relationship between them.
6. As an Account, I want to edit Start directly, so that I can anchor the beginning while keeping End fixed.
7. As an Account, I want editing Start to recalculate Duration, so that the other boundary does not move unexpectedly.
8. As an Account, I want to edit End directly, so that I can anchor the finish while keeping Start fixed.
9. As an Account, I want editing End to recalculate Duration and End gap, so that all four fields remain truthful.
10. As an Account, I want to edit Duration directly, so that I can resize the window while preserving its End and End gap.
11. As an Account, I want to edit End gap directly, so that I can move the whole window while preserving its Duration.
12. As an Account, I want all valid edits to apply immediately, so that the Posts feed and every Scope indicator always reflect the current choice.
13. As an Account, I want incomplete input to remain a draft, so that typing a multi-part value does not temporarily corrupt my Scope.
14. As an Account, I want invalid input explained inline, so that I can correct it without guessing what the application changed.
15. As an Account, I want invalid input to leave my last valid Scope intact, so that a typo does not replace a working selection.
16. As an Account, I want crossed boundaries rejected rather than swapped or repaired, so that the application never makes an unrequested time choice.
17. As an Account, I want a future Fixed end rejected rather than clamped, so that the value on screen is the value actually used.
18. As an Account, I want a minimum Duration of one minute, so that a zero-width or sub-minute window cannot masquerade as useful work.
19. As an Account, I want an End gap of zero to remain valid, so that a Live window can end at the current minute.
20. As an Account, I want mode switching to preserve all four displayed values at that instant, so that changing behavior does not also change my selection.
21. As an Account, I want Live Start and End shown as relative values, so that the moving nature of the window is obvious.
22. As an Account, I want Fixed Start and End shown as exact local timestamps, so that I can identify the precise historical instants.
23. As an Account, I want Duration visible in both modes, so that the size of the selected interval is never hidden.
24. As an Account, I want a Fixed boundary displayed at 02:00 to mean exactly 02:00:00, so that minute precision has an unambiguous boundary.
25. As an Account, I want adjacent Analysis windows to meet without sharing a Post, so that dividing a period does not double-count boundary data.
26. As an Account, I want duration text such as `2h 30m` accepted, so that I can enter common compound values quickly.
27. As an Account, I want relative inputs limited to a predictable grammar, so that acceptance and rejection do not depend on fuzzy natural-language parsing.
28. As an Account, I want a typed valid value to commit after a short pause, so that immediate application does not fire on every intermediate keystroke.
29. As an Account, I want Enter or leaving a field to commit immediately, so that I can finish an edit without waiting for the debounce.
30. As an Account, I want presets to commit immediately, so that one-click changes feel immediate.
31. As an Account, I want the same presets for Duration and End gap, so that both elapsed-time fields use one learnable vocabulary.
32. As an Account, I want `1m`, `30m`, `1h`, `3h`, `8h`, `24h`, `7d` and `30d` presets, so that common windows and gaps are one click away.
33. As an Account, I want zero omitted from the preset row, so that the interface does not promote a special edge value as a common duration.
34. As an Account, I want to type a zero End gap when I need it, so that ending at the current minute remains possible without a dedicated shortcut.
35. As an Account, I want a Duration preset to preserve the existing End gap, so that resizing a deliberately delayed Live window does not move its end to now.
36. As an Account, I want `24h` to mean exactly 24 elapsed hours across daylight-saving changes, so that Duration does not silently gain or lose an hour.
37. As an Account, I want the collapsed Posts control to summarize mode, relative or exact boundaries, and Duration, so that the global window stays glanceable.
38. As an Account, I want a compact popover on desktop, so that the full editor does not permanently consume Posts-page height.
39. As an Account, I want a bottom sheet on mobile, so that the same editor remains usable without a cramped anchored overlay.
40. As an Account, I want the editor to remain open after a valid change, so that I can compare several nearby windows efficiently.
41. As a keyboard user, I want Escape to close the editor and return focus to its trigger, so that the popover behaves predictably without a pointer.
42. As an Account, I want an outside click or a second trigger click to close the editor, so that the compact control follows familiar disclosure behavior.
43. As an Account, I want a new workspace to begin with a 24-hour Live window ending at the current minute, so that the default is useful and understandable.
44. As an Account, I want my last Analysis window remembered for my Account, so that reopening the application preserves my working Scope.
45. As an Account, I want a remembered Live window to resume as Live after reload, so that persistence does not freeze it into yesterday's timestamps.
46. As an Account, I want old saved Start and End values migrated as Fixed, so that the application does not invent a Live intent I never chose.
47. As an Account using several tabs, I want each open tab to keep its in-memory Scope, so that work in one tab does not jump when another tab writes its last-used value.
48. As an Account, I want the Posts feed to refresh on each Live minute boundary while visible, so that newly entering and leaving Posts appear on time.
49. As an Account, I want the Posts feed to refresh when the application regains focus, so that a backgrounded tab catches up immediately.
50. As an Account, I want the Posts feed to refresh after Sync completes, so that newly stored Posts appear without waiting for another timer.
51. As an Account, I want a zero-gap Live end to resolve to the start of the current minute, so that partial minutes do not enter the window early.
52. As an Account, I want browser clock skew to have no effect on an Action's selected Posts, so that the server produces the authoritative result.
53. As an Account, I want Semantic search to respect the Analysis window every time, so that one Posts path cannot silently mean all time.
54. As an Account, I want every downstream Scope surface to show the current Analysis window compactly, so that I can verify what an operation will use.
55. As an Account, I want the Actions tab to link directly to the one Posts editor, so that there is one place to change the Analysis window.
56. As an Account, I want an unfinished Action draft preserved while I edit Scope on Posts, so that checking or changing the window is not destructive navigation.
57. As an Account, I want every UI-created Artifact to originate in Actions, so that Artifact creation has one consistent entry point.
58. As an Account, I want the server to freeze a Live window when I submit an Action, so that queue delay cannot move the Posts used.
59. As an Account, I want every Artifact to retain selected Channels, exact boundaries and every active post filter, so that its Scope can be understood and reproduced.
60. As an Account, I want Summary, Chat, Tag run and Discovery report to freeze Scope the same way, so that Artifact kind does not change temporal meaning.
61. As an Account, I want an Artifact's Analysis window to be immutable, so that inspecting it later still describes the work that produced it.
62. As an Account, I want an Artifact to show exact local Start, exact local End and Duration, so that historical output never relies on changing “ago” text.
63. As an Account, I want Artifact views to omit End gap and former workspace mode, so that immutable history does not pretend to retain a moving window.
64. As an Account, I want opening an Artifact to leave my current workspace Scope unchanged, so that inspection cannot silently replace current work.
65. As an Account, I want a separate Use this Scope action, so that restoring historical inputs is always deliberate.
66. As an Account, I want Use this Scope to restore the exact complete Scope as Fixed, so that immutable timestamps are not reinterpreted as a former Live window.
67. As an Account, I want restored End gap calculated against the current minute, so that all four fields remain truthful after restoration.
68. As a developer, I want one Analysis-window state machine, so that propagation, validation and clock behavior cannot drift between UI surfaces.
69. As a developer, I want one server resolver for Live and Fixed input, so that feed, counts, prompts and Artifact creation use the same exact boundaries.
70. As a developer, I want one shared half-open Post predicate, so that list queries, counts and every Artifact producer agree at both boundaries.
71. As a developer, I want one frozen Scope contract across all four Artifact families, so that adding or changing a filter cannot update only some producers.
72. As a developer, I want old incomplete Artifacts removed before launch, so that missing filters are not presented as a complete historical Scope.

## Implementation Decisions

### One global Analysis-window controller

The current pair of independently managed timestamps becomes one Analysis-window
controller owned by the global Scope. Posts hosts the editor, while feeds,
counts, commands and Action forms consume its committed value. Other tabs may
render a compact representation but do not implement competing editors.

The controller exposes the current mode, the four display fields, the committed
server request shape, per-field drafts and explicit field-edit operations. It
accepts a clock dependency so temporal behavior can be tested without waiting
for wall time.

### Canonical state is mode-specific

The four fields are always presented, but they are not four independent stored
facts. Canonical Live state is mode plus Duration and End gap. Start and End are
derived from the authoritative current minute. Canonical Fixed state is mode plus
exact Start and End UTC instants. Duration is derived from the pair and End gap
is derived from the current minute.

This prevents drift between redundant values. Every valid edit produces a new
canonical state, after which the controller derives all four fields again.

### Deterministic propagation

Each field has exactly one propagation rule:

- Editing Start holds End fixed and recalculates Duration.
- Editing End holds Start fixed and recalculates Duration and End gap.
- Editing Duration holds End and End gap fixed and recalculates Start.
- Editing End gap holds Duration fixed and recalculates Start and End.

These rules apply in both modes. Once the edit commits, normal clock behavior for
the selected mode resumes.

### Mode changes preserve the instant

Changing mode commits immediately and does not change Start, End, Duration or End
gap at the switching instant. Live to Fixed stores the currently resolved exact
boundaries. Fixed to Live stores the current Duration and current End gap. Only
subsequent clock movement reveals the new mode.

### Drafts, parsing and validation

Every editable field has a draft separate from committed Scope. A draft commits
after 400 milliseconds without input, or immediately on Enter or blur. Presets
and mode changes commit immediately. Closing the editor with an incomplete or
invalid draft discards that draft and retains the last valid Scope.

Relative values use a deliberately restricted grammar of positive whole-minute
tokens. Units can be composed in descending order, such as `1d 6h` or `2h 30m`.
General natural-language dates are not parsed. Whitespace is forgiving, but
unknown units, fractions, negative values, duplicates that make the value
ambiguous, and trailing text are invalid.

Duration must be at least one minute. Start must precede End. A Fixed End later
than the server's current minute is invalid. Invalid changes never clamp, swap or
move another value and never invalidate the committed Scope.

### Exact temporal semantics

All canonical timestamps are integer milliseconds in UTC. Every Analysis window
is half-open: a Post is included when its timestamp is greater than or equal to
Start and strictly less than End. The same predicate is shared by feed reads,
counts, Semantic retrieval, prompt assembly and Discovery aggregation.

Fixed editing presents minute precision and normalizes successful Start and End
edits to second and millisecond zero. An end shown as 02:00 is therefore the exact
instant 02:00:00.000 and excluded from the interval.

Duration units are exact elapsed UTC time. One day is 24 hours and one week is
168 hours, independent of daylight-saving transitions. The local clock label may
shift across such a transition without changing the elapsed Duration.

### The server owns now

The backend provides one Analysis-window resolver. It validates Fixed input and
resolves Live input using the start of its current minute. All server operations
that accept Scope call this resolver before selecting Posts.

The frontend maintains an estimated offset from a lightweight server-clock
contract and uses that synchronized minute for previews, labels and timer
alignment. Network latency may slightly affect when a label repaints, but it
cannot change the server's authoritative selection. Action submission always
resolves again on the server.

### Live refresh behavior

While Posts is visible in Live mode, one foreground timer invalidates the feed
and counts at the next synchronized minute boundary and every minute thereafter.
The timer is suspended while the document is hidden. Regaining focus performs an
immediate clock resynchronization and invalidation. Completion of a Sync also
invalidates the current Live feed and counts.

The conceptual Live boundaries remain derived from the current minute even on a
surface that does not fetch Posts. Those surfaces update their relative labels
without creating duplicate feed timers.

### Persistence and migration

Workspace Analysis-window state is browser-local and Account-scoped. Live state
persists only mode, Duration and End gap; resolved timestamps are never its
stored representation. Fixed state persists mode, Start and End. Drafts and
validation errors are not persisted.

Existing account-scoped saved Start and End values migrate once to Fixed state.
Duration and End gap are derived when loaded. No heuristic converts an old end
near the current time into Live. Missing or malformed legacy values fall back to
the new-account default: a 24-hour Live window with zero End gap.

Open tabs do not subscribe to one another's storage events. Each valid commit
writes the last-used value, so the final writer becomes the starting state for a
future reload without disturbing another tab's active work.

### Editor interaction and presentation

Posts replaces the permanently expanded timestamp section with a persistent
summary trigger. A Live summary uses relative boundaries and Duration, such as
`Live · 1d 10h ago → 30m ago (1d 9h 30m)`. A Fixed summary uses exact local
values and Duration, such as `Fixed · Sep 10 09:30 → Sep 11 14:30 (1d 5h)`.

The trigger opens one four-field editor as an anchored popover on desktop and a
bottom sheet on mobile. The editor stays open after commits. The trigger, outside
click and Escape close it; focus returns to the trigger after keyboard closure.
Focus is contained while the mobile sheet is open, every field has a programmatic
label and inline errors are associated with their fields and announced.

Start and End use relative input and output in Live mode and exact local
date-time input and output in Fixed mode. Duration and End gap always use elapsed
time. No ordinary surface displays UTC, an offset or a timezone name.

Focusing Duration or End gap displays the same contextual shortcut row: `1m`,
`30m`, `1h`, `3h`, `8h`, `24h`, `7d` and `30d`. The row applies to the focused
field. Zero remains valid only as typed End gap and is not a shortcut. Choosing a
Duration preset preserves End gap.

### Scope and API contracts

The shared Scope request carries selected Channels, an Analysis-window input and
all active post filters. The Analysis-window input is a discriminated Live or
Fixed value. Consumers do not flatten a Live window into client-resolved Start
and End before sending it to the backend.

The active post filters include keyword, forwarded status, media type,
per-Channel cap, cap mode, sort order and deterministic random seed where
applicable. Semantic and related-Post paths additionally retain the explicit Post
selection needed to reproduce their ranking. Semantic search no longer exposes
an option to ignore the Analysis window; it always receives the resolved Start
and End predicate.

The generated API client is refreshed after the shared request and response
schemas change. All Posts, counts, prompt and Discovery callers move to the same
contract in one change; there is no second legacy interpretation of End.

### Action submission freezes Scope

Every UI-created Artifact begins in Actions. The Actions surface shows the
current Analysis-window summary as a compact control. Activating it navigates to
Posts and opens the canonical editor, while retaining the complete unfinished
Action draft and providing a direct return path.

Submission sends the complete current Scope. The backend validates it, resolves
the Analysis window against the server's current minute and persists the exact
frozen Scope before queueing or beginning expensive work. Worker start time,
completion time, retries and network latency cannot move the frozen boundaries.

### One frozen Scope value for every Artifact

Summary, Chat, Tag run and Discovery report use one validated frozen-Scope value
object and one wire representation. The frozen value contains Channels, exact
Start and End, and every post filter or explicit Post selection that affected the
result. Artifact projections derive Duration from the exact boundaries.

Every Artifact write path persists this value at creation. Subsequent writes may
change Artifact-specific content or flags but cannot replace its frozen Scope.
The unified History read and each detail read expose the same Scope rather than
reconstructing one from a per-kind subset.

Existing pre-launch Artifacts that cannot supply the complete contract are
deleted by a migration. They are not backfilled with invented defaults. The
migration also removes any superseded per-kind representation whose coexistence
could allow the stored Scope values to diverge.

### Artifact display and restoration

Every Artifact surface shows its frozen exact local Start, exact local End and
derived Duration. It does not show End gap, Live mode or relative “ago” values,
because those describe a moving workspace rather than an immutable result.

Opening an Artifact changes only navigation and the Artifact being viewed. It
does not change selected Channels, Analysis window or filters in the workspace.
The existing implicit scope-restoration behavior and its notice are removed.

An explicit **Use this Scope** action replaces the entire current workspace Scope
with the Artifact snapshot. The Analysis window becomes Fixed at the Artifact's
exact boundaries, Duration is derived and End gap is calculated from the
synchronized current minute. The Artifact itself remains unchanged.

## Testing Decisions

Tests assert behavior at three agreed seams and avoid checking component state,
private helper calls or the physical representation of persisted rows.

### Analysis-window controller seam

Controller tests use a fake clock and the repository's existing hook-test style.
They cover both canonical modes, every field propagation rule, mode-switch
invariance, restricted parsing, 400 ms debounce, Enter and blur commits, shortcut
behavior, invalid drafts, minute normalization, daylight-saving presentation,
account-scoped persistence, legacy migration, and independent tabs.

The assertions observe committed Scope and visible field values. They do not
assert reducer action names or the number of internal state updates. The existing
post-filter hydration and persistence hook tests are the closest prior art.

### Backend Scope and Artifact contract seam

API and service tests inject server time and exercise Scope as a caller would.
They prove Live resolution at a minute boundary, Fixed validation, exact UTC
Duration, and the shared half-open predicate with Posts immediately before,
exactly at and immediately after each boundary.

The same fixture is exercised through feed, counts, Semantic retrieval, prompt
assembly and Discovery aggregation so one inclusive-End regression cannot remain
hidden in a secondary path. A parameterized Artifact matrix covers Summary,
Chat, Tag run and Discovery report: each creation path freezes the submission-time
boundaries and complete filter set before a simulated queue delay; each read
returns the same immutable Scope; a later metadata/content update cannot replace
it. Existing Posts-feed, count/prompt parity, auto-regeneration parity, Discover
report snapshot and unified Artifact service tests are the prior art.

The destructive pre-launch migration is tested from the previous schema and from
an empty database. The upgrade removes incomplete legacy rows and produces the
new contract; downgrade behavior is explicit and does not claim to restore
deleted user data.

### One browser workflow seam

One Playwright journey verifies the integration rather than duplicating the
temporal matrix: open the Posts summary, edit the four fields, switch modes,
navigate to Actions without losing a draft, create an Artifact, inspect its exact
read-only Start/End/Duration, confirm that opening it did not change workspace
Scope, then choose Use this Scope and observe a Fixed restoration.

The browser test also exercises keyboard closure and focus return on desktop and
the bottom-sheet presentation at a mobile viewport. It uses role and label
queries for the editor rather than styling classes. Existing workspace/Discover
Playwright flows are the closest prior art.

## Out of Scope

- A standalone single- or dual-thumb time slider.
- A post-volume histogram or draggable brush. It may be considered later as a
  Fixed-only supplement backed by server-side buckets.
- A growing Live window such as “since Monday”. Live windows remain bounded by
  fixed Duration and End gap.
- General natural-language date parsing.
- Second-level controls in the ordinary Fixed editor.
- A global maximum Duration. Individual Actions may estimate cost or warn about
  broad Scopes without changing the shared editor's validity rules.
- Showing timezone names, UTC labels or storage formats in the ordinary UI.
- Synchronizing active in-memory Scope across open browser tabs or devices.
- Reconstructing an Artifact's former Live mode or historical End gap.
- Preserving incomplete legacy Artifacts or guessing the filters that produced
  them.
- Creating Artifacts from Posts, History or the four result tabs.

## Further Notes

The example custom Live window should be rendered as
`1d 10h ago → 30m ago (1d 9h 30m)`. With a 30-minute End gap, choosing the
24-hour Duration preset should produce
`1d 30m ago → 30m ago (1d)`.

At a server time of 14:32:47, a zero-gap Live end resolves to 14:32:00. A Post at
14:32:00 is not in that window until the 14:33 refresh moves the excluded End to
14:33:00.

The compact editor structure was validated in a throwaway prototype before the
four-field contract was finalized. The prototype is useful only for the selected
popover/bottom-sheet layout; its old labels and field set are not an
implementation reference.
