# CRG-04: The existing corpus is backfilled

**Status:** ready-for-agent

**Blocked by:** CRG-01

## What to build

The graph filled from the roughly 4.7 million Posts the deployment already holds,
at full speed, under an Operator's control.

## Why a script and not a migration or the sweep

Migrations run at prestart with the service down. A bulk update across millions of
rows there stalls a deploy for an unknown number of minutes with nothing
reporting progress, and this repo has been bitten by boot-order surprises in
backfill migrations before.

Letting the sweep do it takes about a month. At the current scan limit and tick
interval it moves on the order of a hundred thousand Posts a day. The sweep is
the right steady-state mechanism and the wrong catch-up mechanism.

## Scope

A maintenance script in the shape the others in this repo take, with a dry-run
mode that counts without writing. It calls CRG-01's batch function in a loop with
a large batch size until it returns zero.

It does not reimplement the walk, the extraction, the grace rule or the conflict
handling. That is the point: a backfill carrying its own copy of the logic is one
that can disagree with steady state, and the disagreement surfaces months later
as a graph nobody trusts.

It commits per batch, so an interrupted run resumes where it stopped and a re-run
is safe by construction.

Progress output covers rows written, Posts scanned, Posts deferred and Posts
skipped, per batch and as a total. Use the logger; the no-print lint rule applies.

Add the script to the maintenance script index with a one-line description and
the dry-run-first instruction.

## Running it

Dry run first against the real database and read the counts before anything else.
A large deferred count means a population of channels with no chat id, which is a
real finding rather than a script problem. Work out which channels those are
before letting the grace clock run down on them, because past the grace those
Posts are skipped permanently.

Not against staging. Staging is read-only for verification in this repo.

## Acceptance criteria

- [ ] A dry run reports counts and writes nothing
- [ ] A real run over a seeded fixture set writes the expected rows, and a second
      run writes zero
- [ ] An interrupted run, resumed, completes without duplicating rows
- [ ] Deferred and skipped counts are reported per batch and in total
- [ ] The script appears in the maintenance script index
- [ ] Every new assertion mutation-tested

## Notes

Afterwards the sweep handles only newly scraped Posts and the partial index
shrinks toward empty, the way the harvest's already does.
