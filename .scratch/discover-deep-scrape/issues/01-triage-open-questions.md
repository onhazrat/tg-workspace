# DDS-01: Settle the open design questions before building anything

**Status:** resolved

## What to build

Nothing, yet. This ticket is the gate: get the operator's decision on the four open questions in
`../spec.md` (reuse-vs-separate lane, ranking policy, re-scrape cadence, default on/off), the same
way CRG's spec settled its "argued over" points before CRG-01 wrote a line of code. Use
`AskUserQuestion` rather than guessing — this repo's own convention (see
`docs/agents/domain.md` / the CRG ADR's "Alternatives considered" section) is to argue the
tradeoff in a doc and commit to one answer, not to leave it implicit in the first PR.

## Why this is its own ticket

CRG shipped four tickets because the design was nailed down first (ADR-019 exists, and every
"decision" in it was argued and closed before `models_tg.py` gained a line). This effort starts
one step earlier: the *mechanism* to reuse is known (`DISCOVER_PROBE_LANE`,
`LaneScheduler`), but the policy around it — how much extra Telegram traffic this deployment
should generate for a table nothing reads yet — is not. Writing the lane and the job before that
argument happens risks shipping infrastructure for a policy nobody signed off on.

## Acceptance criteria

- Each open question in `../spec.md` has an answer, recorded either as an edit to that file or as
  a short ADR (matching ADR-019's shape) if the answer is non-obvious enough to need the reasoning
  preserved.
- A follow-up ticket (`DDS-02`) exists, scoped to the settled design, before any code is written.

## Notes

Whoever picks this ticket up should read `docs/migration/ADR-019-channel-reference-graph.md` in
full first — the "Decision 2" and "Decision 3" reasoning (chat-id identity, permanence) directly
constrains what a deep-scraped Post's References can look like, since they land in the same
`tg_post_references` table.

## Answer

Settled with the operator on 2026-09-23. The original four questions dissolved: instead of
deep-scraping unfollowed Channels on a new lane, References feed the Directory. See `../spec.md`.

- Reuse or separate lane: neither. No new lane. The sweep only writes Directory rows and the
  existing probe lane does the fetching.
- Ranking: every queued handle takes the existing harvest priority, whatever its source. A
  separate rung waits until it is needed.
- Re-scrape cadence: the existing refresh (`directoryRefreshDays`, 7) re-probes every live entry
  and now feeds discovery on its own. Unchanged.
- Default on or off: sample-sourced targets default **on**, behind
  `DIRECTORY_FOLLOW_SAMPLE_REFERENCES`. There is no depth cap; the backlog ceiling, the
  spare-capacity lane and the adaptive proxy wait bound the rate, and the probe usage tally
  measures it.

Follow-ups: DDS-02 (the sweep, ADR-020), DDS-03 (drop `Post.harvested`).
