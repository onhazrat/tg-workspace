# 03: Reading a Candidate

**What to build:** An Operator can open a Candidate and read what the Channel actually publishes,
without going to Telegram. The panel carries the row's statistics, the three that would not fit
on a row, and the text of the Channel's recent Posts.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Opening a Candidate shows the same four statistics its row showed, so nothing has to be
      closed to recheck a number
- [ ] The panel adds forward share, script and media density, which ticket 02 stored but showed
      nowhere
- [ ] The Channel's recent Posts sit behind a disclosure, closed by default, so the panel does
      not open onto a wall of text
- [ ] Each Post shows its text truncated, a relative date, its view count and a link to the
      original on Telegram
- [ ] A Candidate with no Directory entry reads as "not probed yet" and offers the existing
      recheck action, which today only reaches rows that already have an entry
- [ ] Opening a panel issues no Telegram request
- [ ] A handle with no entry answers 404
- [ ] The Reference stays where it is; the Channel's own Posts never displace it

## Its own resource family, not Discover's

The read is mounted as a **directory** family in the `/data` package, a new module, not an
addition to the discover module. The Directory is corpus-wide and outlives every report, so
filing its read as report machinery misfiles it, and the Channels tab will want this exact read
with no report in sight.

The handler function name is settled when this ticket is written and never changed afterwards,
because the operation id derives from it and a rename moves a symbol in the generated client.

## The generated client, not the hand-written one

The response is a closed model with required fields, so its generated type is strictly better.
Discover's existing calls are hand-written because *those* models are open or all-optional, which
is a property of the models and not of the tab. Putting this call beside its neighbours for
tidiness is how the two-client split rots, and the conform guard checks both directions.

## Why the Posts are not on the report

Forty Candidates times twenty Post bodies is the 26 MB and 56 MB regressions a third time. The
detail read exists so the report never carries them.

## Why no probe on demand

A panel that fires a Telegram request puts a user-facing trigger on a rate-limited scraper the
harvest is already saturating, and lets a click jump the queue that exists to decide ordering.
The recheck action already goes through that queue; extending its reach is all that is needed.

## Seams

The API projection pattern, in a new module beside the existing directory tests rather than
inside a discover-named one, since the route is not mounted under discover. The route reads
corpus-wide through the greppable unscoped escape hatch with a typed reason, and takes its place
in the account-isolation inventory with that reason.
