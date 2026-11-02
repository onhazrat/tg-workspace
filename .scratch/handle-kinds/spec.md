# Handle kinds: every Directory entry says what its handle is

Status: ready-for-agent

Ticket prefix: `HKD`. One ticket: `issues/01-every-entry-says-its-handle-kind.md`.

Settled in a grilling session on 2026-11-02 that started from embedding
Telegram posts in the Directory panel. The decision record is ADR-047; the
terms are **Directory**, **Directory entry**, **Handle kind** and **Hidden
Channel** in `GLOSSARY.md`.

## Problem Statement

The Directory is meant to show every Channel anyone has seen referenced, but
an Operator browsing it cannot trust what it leaves out. When the probe finds
a handle with no readable preview, it records only one thing worth keeping: a
subscriber count makes the entry a Channel whose Posts are withheld. Every
other answer is filed as `unavailable` with kind `unknown`, whether Telegram
said the handle is a group, a bot, a user, or nobody at all.

On staging on 2026-11-02, 755,285 entries sat in that bucket. A sample of
fifteen held four real Channels (one with 5,493 subscribers), a group and
several users. No entry anywhere carried kind `bot`, `group` or `user`. A
reader who sees internals and lists every kind gets one undifferentiated pile,
and the breakdown "how many cited handles are users" cannot be answered.

The status these withheld Channels carry is `private`, and readers type it in
the Directory filter. In Telegram a private channel is one with no username,
and every one of these has one, so the word misleads.

A group's member count and a bot's monthly users are on the page the probe
already fetched, and are thrown away with it.

## Solution

Every probe classifies the handle from the page it already holds, at no extra
Request. The Directory entry records its Handle kind: `channel`, `group`,
`bot`, `user`, `free` (nobody holds the handle) or `unknown` (the page could
not be read). Only Channels are listed by default, as today.

A Channel whose Posts Telegram withholds is a Hidden Channel. It is listed
like any Channel, its verdict reads "Hidden", and its panel shows its
subscriber count and a link to its Telegram page instead of Samples. The
stored status `private` becomes `hidden` everywhere, including the Directory
filter.

The count Telegram shows for a handle is kept in the existing subscriber
count for every kind: a group's members and a bot's monthly users go there
too, and the table and panel label each with its own unit.

Entries probed before this change keep `unknown`. Reclassifying them costs one
Request each and is a separate effort.

## User Stories

1. As an Operator, I want every probed handle to record what Telegram says it is, so that the Directory stops filing groups, bots and users as unknown.
2. As an Operator, I want a Channel whose Posts Telegram withholds to be listed in the Directory, so that I know it exists even though it cannot be followed.
3. As an Operator, I want a Hidden Channel's verdict to read "Hidden", so that I can tell it apart from a Channel I can follow at a glance.
4. As an Operator, I want a tooltip on "Hidden" that says Telegram hides this Channel's Posts on the web, so that I understand why there is nothing to read.
5. As an Operator, I want a Hidden Channel's panel to show its subscriber count, so that I can judge how big it is.
6. As an Operator, I want a Hidden Channel's panel to link to its Telegram page, so that I can open it in Telegram myself.
7. As an Operator, I want a Hidden Channel's panel to show no Samples section, so that it does not pretend to have Posts we never saw.
8. As an Operator, I want to filter the Directory with `status:hidden`, so that I can list every Hidden Channel.
9. As an Operator, I want an old link carrying `status:private` to keep finding Hidden Channels, so that a bookmarked view does not go empty after the rename.
10. As an Operator, I want `status:unavailable` to keep matching Hidden Channels as it does today, so that a view written for "cannot be followed" keeps its meaning.
11. As an Operator, I want to filter on `kind:free`, so that I can see handles nobody holds.
12. As an Operator who sees internals, I want to filter on `kind:group`, `kind:bot` and `kind:user`, so that I can see each kind of handle the corpus cites.
13. As an Operator who sees internals, I want a group's row to show its member count labelled "members", so that I do not read it as subscribers.
14. As an Operator who sees internals, I want a bot's row to show its monthly users labelled "monthly users", so that I know what the number counts.
15. As an Operator who sees internals, I want a user's and a free handle's row to show no count, so that an absent count is not mistaken for zero.
16. As an Operator who sees internals, I want the panel to show the same count and unit as the table, so that the two never disagree.
17. As an Operator who sees internals, I want sorting by Subscribers in the every-kind view to rank all kinds together by their count, so that I can find the biggest handles of any kind.
18. As an Operator, I want sorting by Subscribers in the default view to keep ranking Channels only, so that the default Directory is unchanged by this effort.
19. As an Operator, I want a handle whose page shows posts to be a Channel regardless of its spelling, so that a Channel whose handle ends in "bot" is never filed as a bot.
20. As an Operator, I want a page with a "Start Bot" button to be a bot, so that the classification follows Telegram's answer, not a guess from the handle.
21. As an Operator, I want a page that names a person and offers "Send Message" to be a user, so that personal accounts are counted as users.
22. As an Operator, I want a page that names nobody and offers "Send Message" to be a free handle, so that a handle nobody holds is not counted as a user.
23. As an Operator, I want a page that matches none of the known shapes to be `unknown`, so that the Directory never invents a kind.
24. As an Operator, I want groups, bots, users and free handles to stay sealed after their first probe, so that classifying them adds no Requests to the Directory's crawl.
25. As an Operator, I want a Hidden Channel to stay sealed as it is today, so that this effort changes no Request volume.
26. As an Operator, I want the Request records for a probe to look exactly as they do today, so that the Requests tab shows no new traffic from this change.
27. As an Operator, I want the Discover tab to show a Hidden Channel candidate the way it shows a private one today, under the new name, so that the rename does not break Discover.
28. As an Operator, I want the stored count and kind of a non-Channel entry to be dated by its probe, so that I know how old a frozen member count is.
29. As a developer, I want one stored real page per Handle kind pinned in a test, so that a Telegram restyle fails a test instead of silently unlisting Channels.
30. As a developer, I want the classification to state that it decides what is listed, so that nobody relaxes it believing it only changes wording.

## Implementation Decisions

- **Keep the page on every soft block.** The fetch layer already parses the
  redirected `t.me/<handle>` page to decide whether a subscriber count makes
  it a withheld Channel; for every other answer it raises with no page. Both
  exceptions carry the page HTML, so the probe can classify whatever Telegram
  answered. No new Request, no change to pacing, charging, retries or Request
  records.
- **One classifier, read from Telegram's own page.** The existing handle-kind
  classifier is rewritten around the page title's verb, with the header line
  and the name deciding within a verb:
  - posts on the page: `channel`
  - `Telegram: View @x` with a subscriber count: `channel` (Hidden)
  - `Telegram: View @x` with a member count: `group`
  - `Telegram: Launch @x`: `bot`
  - `Telegram: Contact @x` with a name: `user`
  - `Telegram: Contact @x` with no name: `free`
  - anything else: `unknown`

  The handle's spelling plays no part: 574 readable Channels on staging end in
  "bot". The presence-line rule ("last seen", "online") goes, since the page
  never shows it. The classifier's docstring says the kind decides listing.
- **Handle kind values.** `channel`, `group`, `bot`, `user`, `free`,
  `unknown`. `free` is new. The Directory filter's `kind` values and the
  server's accepted values both gain it. Only `channel` is listed by default;
  the every-kind view for readers who see internals is unchanged.
- **The probe stores what it classified.** The no-preview branch of the probe
  stops synthesizing an empty payload: it reads the page's kind, display name
  and count, and stores them with the `unavailable` verdict and empty Samples,
  as today. A user's name is not stored (decided while implementing HKD-01):
  the Directory records that a person holds the handle, not who. A withheld Channel keeps its own branch and its `hidden` verdict.
- **Status `private` becomes `hidden`.** A data migration rewrites stored
  rows; the verdict function writes `hidden`; the set of statuses that cannot
  be followed holds `unavailable` and `hidden`; the frontend status type, the
  filter's status values and Discover's candidate handling use `hidden`. The
  server reads a filter Condition `status:private` as `status:hidden`, so an
  old link keeps working; the filter picker offers only `hidden`.
  `status:unavailable` keeps matching both, as it does today.
- **One count column for every kind.** The existing subscriber count holds a
  Channel's subscribers, a group's members and a bot's monthly users, parsed
  with the existing counter parsing (exact below 1,000, rounded above). A
  group's online count is not stored. No schema change for counts. The column
  header stays "Subscribers"; each cell and the panel show the count with the
  unit its Handle kind implies ("members", "monthly users"), and Channels keep
  today's rendering. Sorting is unchanged: one column, all kinds together in
  the every-kind view.
- **Hidden Channel display.** The table's verdict cell reads "Hidden" with a
  tooltip; the panel shows the subscriber count, a link to the Channel's
  Telegram page, and no Samples section.
- **Sealing is unchanged.** Only `ok` entries come due for a Refresh. Every
  verdict this effort writes is already sealed, so the Directory's Request
  volume does not change.
- **No backfill.** Entries probed before this change keep `unknown`. A Recheck
  of one entry reclassifies it through the same path.

## Testing Decisions

- A good test drives the system from its edge and observes what a reader
  would see. Here that is: Telegram answers a handle with a real page, the
  probe runs, and the Directory read reports the entry. Tests do not call the
  classifier's private helpers or inspect the probe's payload dict.
- **Backend seam (one).** Probe a handle end to end with Telegram faked at
  the HTTP transport, so the redirect handling and the soft-block page
  parsing run for real. Assert the entry through the Directory read API:
  status, Handle kind, count, and whether the default view lists it. One
  stored real page per Handle kind (readable Channel, Hidden Channel, group,
  bot, user, free handle) is the fixture set; capturing them is part of the
  work, in the existing live-fixture directory with sidecar metadata. These
  same tests are the restyle guard.
- Further backend cases at the same seam: a Channel whose handle ends in
  "bot" is a Channel; `status:private` finds Hidden Channels; `status:unavailable`
  finds both; a probe of each kind records exactly one Request, as before.
- The migration is checked by a test that seeds a `private` row, runs the
  data step, and reads `hidden` back, if the repo's migration tests offer that
  seam; otherwise by the backend seam above after `alembic upgrade head`.
- **Frontend seam.** The existing Directory table and panel render tests:
  "Hidden" verdict with its tooltip, the count with each kind's unit, no count
  for users and free handles, and no Samples section for a Hidden Channel.
  The Directory filter's own tests cover `kind:free` and `status:hidden`.
- Prior art: the HTTP-faked Telegram in the Request stats and Request kinds
  API tests; the handle-kind classifier tests; the Directory filter, table
  and panel component tests.
- Every new guard is mutation-checked before it is trusted, per the repo's
  mutation script.

## Out of Scope

- Reclassifying the ~737k entries probed before RQS-13. It needs one Request
  per entry and its own budget.
- Chat ids for Hidden Channels and groups. They need one embed Request each.
- Embedding Telegram posts anywhere in the app.
- Storing a group's online count.
- A new sort, column or filter for counts by kind.
- Making free handles come due for a Refresh.
- Changing how a followed Channel that loses its preview is synced.

## Further Notes

- Reading `status:private` as `status:hidden` in the filter was decided while
  writing this spec, to keep bookmarked links working. It is the only alias.
- The glossary keeps "subscribers" as a Channel counter. Holding a group's
  members and a bot's monthly users in the same stored count is a storage
  choice (ADR-047), not a change to the term.
- Page shapes were verified against live `t.me` on 2026-11-02 for `durov`,
  `fsdj94`, `vsevcapoeira_group`, `helper_bot`, `BotFather`,
  `marzbanix_official` and an unheld handle.
