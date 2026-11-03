# ADR-047: The Directory maps handles, classified by the page already fetched

**Status:** Accepted (2026-11-02); its "a user's name is not stored" superseded by ADR-048. Decided in a grilling session that started
from embedding Telegram posts in the Directory panel.

## Context

The Directory was defined as a map of Channels, but every handle a Post links
to becomes an entry, so it also holds groups, bots, users and handles nobody
holds. The probe asks for `t.me/s/<handle>`; for a handle with no preview
Telegram redirects to `t.me/<handle>`, and that page says what the handle is.
The probe read it for one thing only: since RQS-13 (2026-10-24) a subscriber
count makes the entry a Channel whose Posts are withheld, stored as
`status=private`. Every other page was thrown away and stored as
`unavailable` with kind `unknown`.

On staging on 2026-11-02 that bucket held 755,285 entries, about 737k of them
probed before RQS-13. A sample of fifteen held four real Channels Telegram
hides (`fsdj94`, 5,493 subscribers), a group and users. No entry carried kind
`bot`, `group` or `user`. Neither `private` nor `unavailable` is ever
refreshed, so the misfiled Channels stay hidden from the Directory list.

## Decision

The Directory is a map of every handle, and each entry carries its Handle
kind, read from the page the probe already holds, at no extra Request:

- The page's title verb names the kind: `Telegram: Launch @x` is a bot,
  `View @x` a Channel or a group (a subscriber count or a member count
  decides which), `Contact @x` a user when a name shows and a free handle
  when none does. A page with posts is a Channel. A page that matches none
  of these is `unknown`.
- The kinds are `channel`, `group`, `bot`, `user`, `free` and `unknown`.
  Only `channel` is listed by default, so the kind decides what is listed; a
  scraper test pins one stored page per kind, so a Telegram restyle fails
  loudly instead of silently unlisting Channels.
- A Channel whose Posts Telegram withholds is a Hidden Channel: listed like
  any Channel and shown as "Hidden" with its subscriber count, a `t.me` link
  and no Samples. The stored status `private` becomes `hidden`, in the data,
  the wire type and the Directory filter, because in Telegram a private
  channel is one with no username and these all have one.
- The `subscribers` count holds a group's members and a bot's monthly users
  too, labelled with the kind's unit in the table and the panel. A group's
  online count is not stored. Sorting by it in the every-kind view ranks the
  kinds together.
- Every non-Channel kind stays sealed, as `unavailable` entries are today, so
  the Directory's Request volume does not change.

## Consequences

New probes stop adding to the `unknown` bucket; the entries probed before
this change stay `unknown`. A member or monthly-user count is frozen at the
first probe, dated by the probe's time.

## Alternatives rejected

- **A map of Channels only**: evicting the other kinds throws away the
  evidence that stops a bot being probed twice.
- **Classifying the old entries by the `bot` suffix**: every bot's handle ends
  in `bot`, but so do 574 readable Channels on staging (`newbot`, 215,000
  subscribers).
- **Classifying them from stored References**: a post link proves a Channel
  or a group, never which, and never finds a Hidden Channel.
- **Re-probing the old entries now**: one Request per entry, about 737k. It is
  the only way to recover the Hidden Channels among them, and is deferred to
  an effort that budgets for it, together with the chat ids that need one embed
  Request per Hidden Channel or group.
