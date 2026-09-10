# ADR-018: One global Analysis window with explicit Live and Fixed modes

**Status:** Accepted (2026-09-11). Extends the frozen Scope in
[ADR-010](./ADR-010-artifact-model.md).

## Context

The Posts tab currently exposes a start timestamp, an end timestamp and quick
range buttons. The buttons look relative, but choosing one writes two absolute
timestamps; the apparent live range then stops moving. Editing a boundary past
the other silently moves the other boundary. The controls display minute
precision while the backend compares exact timestamps, so the meaning of an
end such as 02:00 is not apparent.

This is not merely a Posts-list preference. Summaries, Chats, Tag runs and
Discovery reports operate on the same Scope, and an Artifact is meant to retain
the Scope that produced it. Different temporal semantics in different surfaces
would make the same apparent selection produce different work.

## Decision

Scope has one global **Analysis window**. Posts is where the Account edits it;
every downstream surface that uses Scope shows a compact representation of the
current window.

The Account explicitly chooses one of two modes. The mode is never inferred
from the selected timestamps:

- A **Live window** is a bounded interval whose boundaries remain fixed offsets
  from the current time. It may end now or deliberately exclude the newest
  period: for example, from 10 hours ago until 30 minutes ago. Both boundaries
  advance together. Growing “since this instant” windows are not Live windows.
- A **Fixed window** is a pair of exact, non-moving timestamp instants. An end
  shown as 02:00 means exactly 02:00:00, not the remainder of that minute.

Analysis windows are half-open intervals: the start is included and the end is
excluded. Two adjacent windows can therefore meet at the same exact timestamp
without counting a Post twice.

Every valid edit applies to the global Scope immediately. An invalid edit does
not alter the last valid Scope and does not silently move, swap or repair the
other boundary; the editor explains the error inline.

The editor always presents four linked fields: **Start**, **End**, **Duration**
and **End gap**. Duration is `End - Start`; End gap is the elapsed time from End
to the current time. In Live mode, Duration and End gap remain fixed while Start
and End advance. In Fixed mode, Start and End remain fixed, Duration remains
fixed with them, and End gap grows as time passes.

All four fields are editable in both modes, with one deterministic propagation
rule per field:

| Edited field | Held fixed | Recalculated |
|---|---|---|
| Start | End | Duration |
| End | Start | Duration and End gap |
| Duration | End and End gap | Start |
| End gap | Duration | Start and End |

After the edit, the selected mode's normal clock behavior resumes.

Changing modes does not alter any of the four displayed values at the switching
instant. It changes only which values advance with the clock afterwards. Live
state persists as mode plus Duration and End gap and resumes against the new
current time after a reload; it is never persisted as resolved timestamps.

While Posts is visible, its Live result refreshes once per minute. It also
refreshes when the app regains focus and when a Sync completes. The conceptual
boundaries continue to follow the current time even where no server read is
needed.

Live boundaries resolve against the start of the current minute. At 14:32:47,
a zero-offset Live end is exactly 14:32:00, and the partial minute enters the
window on the 14:33 refresh. Switching to Fixed or freezing an Artifact
therefore preserves the boundaries without hidden second-level rounding.

In Live mode, Start and End are displayed as relative values such as
`1d 10h ago` and `30m ago`. In Fixed mode, they are displayed as exact local
timestamps. Toggling mode changes that representation but not the underlying
instants at the switching moment. Duration is always visible.

The Fixed editor displays minute precision. A displayed `HH:mm` is an explicit
exact timestamp with seconds fixed to `:00`; it does not stand for that whole
minute. Ordinary Fixed editing does not expose seconds.

Timestamps are stored and compared in UTC everywhere. The interface silently
converts them to the browser's local timezone for display and editing. Storage
format, UTC and the local timezone name are implementation details and do not
appear in the ordinary interface.

A new Account starts with a 24-hour Live window and an End gap of zero. Duration
and End gap use the same contextual shortcut row when their respective field has
focus: `1m`, `30m`, `1h`, `3h`, `8h`, `24h`, `7d` and `30d`. Duration must be
at least one minute. End gap may still be entered as zero to end at the current
minute, but zero is not a shortcut. A custom Live window presents its two
relative boundaries and derives the elapsed duration, for example
`1d 10h ago → 30m ago (1d 9h 30m)`.

A Duration preset preserves the current End gap. With an End gap of `30m`,
choosing `24h` produces `1d 30m ago → 30m ago (1d)`, rather than resetting the
End to now.

Relative boundary text accepts a restricted, composable grammar such as `30m`,
`2h 30m` and `1d 6h`, at whole-minute precision. It does not attempt to parse
general natural language. A valid typed value commits after 400 ms without
further input, or immediately on Enter or blur; presets and mode changes commit
without a debounce.

Duration tokens name exact elapsed time in UTC. `24h` is always 24 hours and
`7d` is always 168 hours, including across a daylight-saving transition; local
clock presentation may therefore shift.

A Fixed end later than the current instant is invalid. It receives the same
inline-error and last-valid-Scope treatment as crossed or incomplete
boundaries; it is never silently clamped.

On Posts, the editor is opened from a persistent compact summary such as
`Live · 1d 10h → 30m ago (1d 9h 30m)`. A Fixed summary uses exact local values,
for example `Fixed · Sep 10 09:30 → Sep 11 14:30 (1d 5h)`. The editor opens as
an anchored popover on desktop and as a bottom sheet on mobile. The collapsed
summary keeps the active global window glanceable without giving the full
editor permanent page height. A change leaves the editor open so several
windows can be compared; the trigger, an outside click or Escape closes it.

Every Artifact kind freezes the complete Scope: selected Channels, the
Analysis window and all active post filters. When the Account submits an Action,
the server resolves its Live window to exact Fixed boundaries and records that
snapshot before any queue delay. Worker start or completion time cannot move the
window. Every UI-created Artifact originates in the Actions tab, and its frozen
Analysis window is immutable after creation.

An Artifact always presents the exact local Start and End timestamps and the
derived Duration, and omits End gap and the former workspace mode. It never
substitutes relative “ago” boundaries for those immutable instants.

Opening an Artifact displays that frozen Scope without altering the current
workspace Scope. Restoring it is a separate **Use this Scope** action. This
prevents inspecting History from silently replacing a Live workspace with an
old Fixed selection.

**Use this Scope** restores the Artifact as a Fixed window with its exact Start,
End and Duration, then calculates End gap against the current minute. It cannot
recreate a former Live mode from an immutable pair of timestamps.

Before submission, the Actions tab displays the current Analysis window as a
compact control that navigates to Posts and opens the one editor. After
creation, an Artifact displays its frozen Analysis window read-only; **Use this
Scope** changes the current workspace, never the Artifact.

## Consequences

Persisted workspace state must carry mode plus either a Live duration or two
Fixed timestamps. Live persistence also carries End gap. Storing only the
currently resolved Start and End would turn a Live window into a Fixed one after
reload. Workspace persistence is browser-local and Account-scoped; different
devices may intentionally hold different working Scopes.

Existing browser-saved Start and End values migrate as a Fixed window. Duration
is derived and End gap is calculated against the current minute. The migration
does not infer Live from an End that merely happens to be close to now.

Open browser tabs keep independent in-memory Scopes and do not react to each
other's storage events. Each valid change still writes the Account-scoped
last-used value, so the most recent write becomes the starting Scope after a
future reload.

Minute-only Fixed editing must normalize both boundaries to `:00` seconds on a
valid edit. Half-open comparison must be shared by list queries, counts and
every Artifact producer; preserving the current inclusive-end query would make
the same Scope mean different things across operations.

All four Artifact write paths and their read models must carry the same complete
Scope snapshot. Existing partial snapshots are discarded during the pre-launch
migration, not treated as permission to weaken the model for one Artifact kind.

Immediate application means the editor needs a draft representation while an
input is incomplete or invalid, even though there is no Apply action. The
committed Scope remains the last valid value until the draft becomes valid.

The Posts query needs a foreground-only minute timer and focus/Sync
invalidation. Other surfaces can render a moving Live label without repeatedly
reading Posts; Action submission resolves and records the exact boundaries.

The server clock defines the current minute used for Live resolution and End
gap. The frontend tracks its offset from server time for matching previews
and minute ticks. Browser clock skew must not change which Posts an Action uses.

The first version has no standalone time slider. Unlimited retention gives a
thumb no stable scale, and a thumb is a poor editor for exact timestamps. A
post-volume histogram with a draggable brush may supplement the exact controls
later, but only in Fixed mode; it must use server-side buckets rather than load
the corpus into the browser.

Semantic search always respects the current Analysis window. The existing
option to ignore it is removed; an apparently global Scope cannot silently mean
“all time” for one Posts query.

There is no global maximum Duration. An Action may warn or estimate cost for an
unusually broad Scope, but the shared window editor does not impose one cost
policy on every Artifact kind.

Following the Analysis-window control from an unfinished Action to Posts keeps
the complete Action draft and provides a direct return path. Editing Scope is
not a destructive navigation event.

Legacy Artifacts that cannot supply a complete frozen Scope are discarded by
the migration rather than displayed or restored as if their missing filters
were known. This destructive compatibility policy is acceptable before launch
because the only existing Accounts belong to the product team.

## Alternatives considered

**Make every selection Fixed.** Rejected because a person asking for “last 24
hours” may intentionally want a window that remains current.

**Infer Live from a preset and Fixed from manual input.** Rejected because two
visually similar windows would then behave differently without an explicit
choice.

**Allow a growing Live window such as “since Monday”.** Rejected for the first
version. One bounded rolling model is easier to predict and compare over time.

**Treat an end minute as inclusive through 02:00:59.999.** Rejected. Boundaries
are exact instants, even when the control presents a coarser display.

**Include both exact endpoints.** Rejected because adjacent windows would both
contain a Post exactly on their shared boundary.

**Normalize invalid boundaries automatically.** Rejected because silently
changing a second value violates immediate, visible control of a global Scope.

**Use a standalone dual-thumb time slider.** Rejected because its precision and
scale are both misleading when the corpus has no fixed retention boundary.

**Persist or display local timestamps as if they were canonical.** Rejected
because the same Scope would then resolve to different instants on devices in
different timezones. UTC is canonical; local time is presentation.

**Keep the editor permanently expanded.** Rejected because the window consumes
substantial vertical space even when the Account only needs to confirm the
current Scope.

**Place the editor in a desktop sidebar.** Rejected because it permanently
narrows the Posts list and has no natural mobile equivalent.
