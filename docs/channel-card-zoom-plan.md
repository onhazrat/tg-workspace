# Channel card zoom levels

Status: design agreed 2026-09-28, not implemented.

The Channels tab gets four card zoom levels, -2 to +1. Level 0 is the card as it
is today.

## Levels

| Level | Shows | Click on the card body |
|---|---|---|
| +1 | Everything at 0, plus all eight `showChannel*` fields forced on (bio, subscribers, Telegram chat ID, photos, videos, files, links, Start ID) regardless of settings. Nothing else changes. | Inert, checkbox only |
| 0 | Today's card. `showChannel*` settings apply as they do now. | Inert, checkbox only |
| -1 | Avatar, display name, @handle, Sync button. Keeps the syncing overlay, frozen mark, queue `#n` badge and Unavailable badge, because they explain a busy or disabled Sync. Drops every stat chip, tags, language, partial-history, sort-rank badge, hover freeze/reset/remove bar, and the checkbox. | Toggles selection everywhere except the Sync button |
| -2 | Avatar only. Selected shows the same ring as a selected card; syncing is a spinner over the avatar; frozen is a dimmed avatar; hover tooltip gives display name and @handle. No other badges. | Toggles selection |

Selection keeps working while a channel syncs, at every level.

## Control

Two icon buttons, "Compact cards" and "Detailed cards", at the right end of the
always-visible top toolbar (`ChannelGridToolbar`, after Sync All). Disabled at
-2 and +1 respectively. No visible level number. Not placed in the bulk-action
bar: that bar only renders while something is selected.

The level is a settings-schema entry beside the `showChannel*` keys. Those
have no backend section, so it is remembered per account in one browser.

Spec and tickets: `.scratch/channel-card-zoom/`.

## Grid density

Each level sets a minimum card width and the column count derives from it,
replacing the fixed breakpoints in `lib/channels/grid-lanes.ts`. Starting
values: +1 about 360px, 0 as today, -1 about 220px, -2 about 72px. Tune by eye.

## Range select (all levels)

- Shift-click selects or deselects the run between the anchor and the clicked
  card. At 0 and +1 the shift-click is on the checkbox; at -1 and -2 on the card.
- The range takes the state the clicked card is moving to. Selections outside
  the range are untouched (Gmail style).
- The anchor is the last card clicked, plain or shift. All / None / Revert do
  not clear it.
- "Between" is the current on-screen order. If the anchor is no longer visible
  (search, filter or sort changed), the shift-click is a plain toggle and
  becomes the new anchor.
- Frozen and Unavailable channels inside the range are swept in, as a
  one-by-one click would.

## Not in scope

- `CONTEXT.md`: zoom level is presentation, not a domain term.
- Keyboard shortcuts or ctrl+scroll for zoom.
