# 03: Reading a Candidate

**What to build:** An Operator can open a Candidate and read what the Channel actually publishes,
without going to Telegram. The panel carries the row's statistics, the three that would not fit
on a row, and the text of the Channel's recent Posts.

**Blocked by:** 02

**Status:** done

- [x] Opening a Candidate shows the same four statistics its row showed, so nothing has to be
      closed to recheck a number
- [x] The panel adds forward share and script, which ticket 02 stores but shows nowhere, and
      media density, which ticket 02 derives at read from the counters
- [x] Media density is absent for an entry Telegram no longer serves, because the counters it
      derives from are cleared with the page, exactly as the subscriber count already is
- [x] The Channel's recent Posts sit behind a disclosure, closed by default, so the panel does
      not open onto a wall of text
- [x] Each Post shows its text truncated, a relative date, its view count and a link to the
      original on Telegram
- [x] A Candidate with no Directory entry reads as "not probed yet" and offers the existing
      recheck action, which today only reaches rows that already have an entry
- [x] Opening a panel issues no Telegram request
- [x] A handle with no entry answers 404
- [x] The Reference stays where it is; the Channel's own Posts never displace it

## What shipped

`GET /data/directory/{handle}/posts`, a new `directory` module in the `/data`
package, on the **generated** client. It serves the sample Posts the last probe
stored and nothing else: the statistics were already on the wire from ticket 02,
so the panel reads them off the Candidate it was opened from and the route
carries only what the report deliberately does not.

**404** is the deployment holding nothing about the handle: no verdict *and* no
Posts. The verdict half is the rule `probe_map` applies to the report join —
this table is also the work queue, so a queued row is not an answer — but the
verdict alone would have been wrong, because `requeue_probes` clears the verdict
and keeps the samples on purpose, saying they are "the one part of the entry
worth reading for however long the queue takes". Gating the read on the verdict
would have blanked them anyway. So a rechecked Candidate shows no statistics and
still shows what the Channel published.

`200 []` is the other absence: a probed entry whose snapshot went with an
`unavailable` verdict or aged out on the sample window.

The Post bodies travel whole and the panel clamps them in CSS. The argument
against bodies on the report is forty Candidates times twenty of them; it does
not reach a detail read of one, and truncating server-side would cost a round
trip to read a Post somebody wanted to read.

The recheck button is offered unconditionally, where the row offers it only once
a verdict exists to overturn. No backend change was needed for that:
`requeue_probes` has always created the row it needs, because asking about a
handle nobody has looked at is a reasonable thing to do.

The panel holds the Candidate it is open on **by name**, not as an object. The
frozen copy was harmless while the sheet showed signal counts and a Reference
pointer, neither of which changes; it is not harmless now that the sheet renders
probe-derived statistics, because the sweep resolving a handle left an open
panel reading "Not probed yet" for ever, and pressing Recheck left it showing a
cadence the server had just disowned beside the words saying so.

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
