# AW-04: The Posts editor, and a window that moves

**What to build:** One compact editor on Posts for the whole Analysis window,
and the refresh behaviour that makes a Live window actually live. The permanently
expanded timestamp section becomes a summary trigger that opens a four-field
editor, and a visible Live view keeps up with the clock on its own.

**Blocked by:** AW-03

**Status:** done

## The rule this ticket makes true

There is one place to edit the Analysis window. Every other surface renders it
compactly and none of them implements a competing editor or a second feed timer.

## Acceptance criteria

- [x] Posts shows a persistent summary trigger carrying mode, boundaries and Duration, relative in Live and exact local in Fixed.
- [x] The trigger opens one four-field editor: an anchored popover on desktop, a bottom sheet on mobile.
- [x] Start and End use relative input and output in Live and exact local date-time input and output in Fixed; Duration and End gap always use elapsed time; Duration is always visible.
- [x] Focusing Duration or End gap shows the same shortcut row — `1m`, `30m`, `1h`, `3h`, `8h`, `24h`, `7d`, `30d` — applying to the focused field. Zero is typeable but is not a shortcut.
- [x] Presets and mode changes commit immediately; a Duration preset preserves the current End gap.
- [x] The editor stays open after a valid change so nearby windows can be compared.
- [x] The trigger, an outside click and Escape all close it; keyboard closure returns focus to the trigger.
- [x] Focus is contained while the mobile sheet is open, every field has a programmatic label, and inline errors are associated with their field and announced.
- [x] While Posts is visible in Live mode, one foreground timer invalidates the feed and counts at the next synchronized minute boundary and every minute after.
- [x] The timer is suspended while the document is hidden; regaining focus resynchronizes the clock and invalidates immediately.
- [x] Completion of a Sync invalidates the current Live feed and counts.
- [x] Other surfaces update their relative labels from the same derived minute without creating duplicate feed timers.

## Notes

A throwaway prototype validated the popover and bottom-sheet layout. Take the
layout from it and nothing else — its labels and field set predate the four-field
contract and are not an implementation reference.

There is no time slider in this ticket. A Fixed-only histogram brush would need
server-side buckets and remains a separate decision.
