# AW-05: Frozen Scope, the contract and the Summary

**What to build:** One complete, immutable Scope snapshot taken when work is
submitted, proven end to end on Summaries. Submitting sends the whole current
Scope, the server resolves the window against its own current minute and
persists the exact boundaries before any queueing or expensive work, and nothing
afterwards can move them.

**Blocked by:** AW-03

**Status:** ready-for-agent

## The rule this ticket makes true

An Artifact is paid for in Posts, and it records exactly which Posts. Queue
delay, worker start time, retries and network latency cannot change what a
finished Artifact says it used.

## Acceptance criteria

- [ ] One validated frozen-Scope value object and one wire representation exist, holding selected Channels, exact Start and End, and every post filter that affected the result.
- [ ] The filter set covers keyword, forwarded status, media type, per-Channel cap, cap mode, sort order and the deterministic random seed where applicable.
- [ ] Semantic and related-Post paths additionally retain the explicit Post selection needed to reproduce their ranking.
- [ ] Consumers send the discriminated Live or Fixed window and do not flatten a Live window into client-resolved boundaries first.
- [ ] Summary submission persists the frozen value before queueing; a simulated queue delay does not move the stored boundaries.
- [ ] The Summary read model returns that value rather than reconstructing one from a per-kind subset, and derives Duration from the exact boundaries.
- [ ] A later content or flag update on a Summary cannot replace its frozen Scope.
- [ ] Backend tests inject server time and prove Live resolution at a minute boundary and Fixed validation through the real submission path.
- [ ] The generated API client is regenerated.

## Notes

Discover reports already store the full filter set while Summaries, Chats and Tag
runs store channels and dates only. This ticket sets the shape all four will
share; AW-06 moves the remaining three onto it.
