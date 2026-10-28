# ADR-042: Tags are listed by Tag use, per tab, kept per Account

**Status:** Accepted (2026-10-28). Decided in a grilling session after the
prototype `prototype/channel-tags-usage` (variant B); no spec yet.

## Context

Every list of Tags was ordered by how many Channels carry each Tag, with the
Channels tab's dropdown also grouping by selection. An Account with a few large
Tags it rarely uses and many small ones it uses daily scrolled past the large
ones every time. The Channels tab, the Directory and the Requests tab each show
Tags, and each tab is used for different work: the Directory to build Tags,
the Channels tab to filter followed Channels, the Requests tab to find what
costs Requests.

## Decision

Every list of Tags on a tab is ordered by that tab's Tag uses, highest first,
then by how many of the tab's Channels carry the Tag, then by name. A Tag use
is an Account's deliberate act naming the Tag on that tab: selecting or
filtering by it (its Channels as Seeds included), or putting it on or taking it
off a Channel by hand. Each use counts 1 and halves every 14 days.

Tag uses are kept on the server, per Account and tab, so every device an
Account signs in on shows the same order. A rename carries a Tag's uses to the
new name on every tab; deleting a Tag, or untagging its last Channel, ends
them, so a later Tag of the same name starts with none. A Tag run is not a Tag
use, and a View-as session shows the target's order and records no Tag use. A
list keeps its order while it is open, so the row just clicked never moves
under the pointer; the new order shows the next time it opens.

## Considered options

- **Order by recent assignments** (each Tag row's assignment time, decayed).
  Prototyped and dropped: it measures how recently a Tag was put on Channels,
  mostly by Tag runs and bulk tagging, not which Tags the Account reaches for.
- **One order for every tab.** Dropped: a Tag used daily to filter the
  Channels tab is noise at the top of the Directory, where the Account is
  building different Tags.
- **Tag uses in browser storage** (prototype variant A). Dropped: the Account
  uses the workspace from several devices, and each browser learned its own
  order.

## Consequences

- A per-Account table of Tag uses, under the tenancy seam like any
  user-owned table, and a route to read and to record them.
- Each tab's Tags dropdown needs its counts in one call, so the server answers
  how many of a tab's Channels carry each Tag. Setting groups are not Tags and
  get their own Groups dropdown, so that answer leaves them out.
