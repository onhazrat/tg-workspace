# RQS-14: Every other kind of work recorded

**What to build:** Handle checks, follows, Bot API calls and anything undeclared are recorded, so no Request to Telegram goes unseen. Spec: "What a Request is", "Recording".

**Blocked by:** RQS-01

**Status:** done

- [x] Handle checks are recorded from the API process, kind handle check, Uncharged, with the buffer flushed on shutdown; outcome by the shared rule.
- [x] Bulk follows record kind follow, charged as the ledger charges them; an auto-follow inside a sync records under that sync's kind.
- [x] Bot API calls (publishing, bot info, bot files) record kind Bot API, Uncharged.
- [x] A Request with no recording context records kind Other; a guard fails when any known path records Other.
- [x] Tests at seam 1 of the spec: Telegram faked at `network._fetch_once`, the work run for real, results read through the Requests API over HTTP after flushing and running the rollup.
- [x] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.

## Comments

- 2026-10-23: implemented on `claude/rqs-14` and merged into the integration branch in 6d3e8e90a8a0737ee44b3331bf8f7568ebc1113c (fast-forward).
  Open: `/scrape` and `/resolve-start-time` record as handle checks, untested, since RQS-19 removes them; some tests still read `_recorded` rows directly, for RQS-10 to move onto its endpoint.
