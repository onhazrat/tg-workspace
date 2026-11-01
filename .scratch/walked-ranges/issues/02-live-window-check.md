# WR-02: The window check updates live as syncs land

**What to build:** The banner on the Action and Posts tabs, and each row of the
gate, change about a second after any sync stores Posts for one of the
Account's Channels, whichever Account's sync it was. The worker announces which
Channel changed; the API forwards the names of followed Channels on one
Account-wide event stream, gathered per second; the browser asks the check for
those Channels alone, merges their verdicts and recomputes the Scope's totals.
The gate stops asking every 2 seconds and continues the moment the last Channel
it waits on lands. After a reconnect the browser asks the whole check once. A
Live window's tick still asks the server; a Fixed window's never does.

Spec: `.scratch/walked-ranges/spec.md`, user stories 39 to 52, and the Live
updates decisions.

**Blocked by:** WR-01 (the check must answer one Channel cheaply).

**Status:** ready-for-agent

- [x] The worker sends a notification carrying only the Channel's name when a walk applies a page that stored Posts or read the head, and when a Hole closes, on its own channel of the existing notification module.
- [x] The API keeps one listening connection, fans out in process, and serves one Account-wide event stream of followed Channel names, gathered for up to a second; an unfollowed Channel never reaches a subscriber.
- [x] The stream is a safe read open to View-as and answers for the viewed Account; it joins every route inventory and the View-as read-path inventory.
- [x] The browser subscribes while the Action or Posts tab is open, asks the check for the named Channels only, merges their verdicts into the cached answer, and recomputes held Posts, Unproven Posts and the floor from the verdicts.
- [x] The gate's wait for syncs it joined ends on events instead of a 2-second poll, and continues as soon as the last waited Channel lands.
- [x] On reconnect the browser asks the whole check once.
- [x] A Live window still asks again on its tick; a Fixed window never does.
- [x] Backend tests: an applied page produces an event for a follower and none for a non-follower; a burst is gathered; View-as answers for the viewed Account. Frontend unit tests: one Channel's verdict replaces its row and the totals follow; the gate flow ends on an event. Each guard is mutation-checked.

## Comments

- 2026-11-01: implemented on `claude/charming-sinoussi-3d3d4e`. Three departures, each because the check reads syncs in flight from the job row, which is flushed every 5 s: a Channel is also announced when the flush records its sync over, every Channel of a job once the job ends, and every Channel of a job a worker restart fails. Without them the gate waits on a landing nobody announces. The gate listens from its click to its finish, so review rows flip too, and its final full check after the wait stays (one 300 ms ask). Left out: a heartbeat, so a stream that dies silently (a laptop asleep) is not noticed until the page reloads.
