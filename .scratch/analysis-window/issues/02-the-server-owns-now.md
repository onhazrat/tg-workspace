# AW-02: The server owns now

**What to build:** Let a caller send an Analysis window that is explicitly Live
or Fixed, and have the server decide what that means. One backend resolver
validates a Fixed pair and resolves a Live one against the start of the server's
current minute, and a lightweight server-time contract lets the browser match
that minute for its own previews.

**Blocked by:** AW-01

**Status:** ready-for-agent

## The rule this ticket makes true

Browser clock skew cannot change which Posts an operation selects. Every server
operation that accepts Scope resolves the window through one resolver before it
selects anything, and network latency can only move when a label repaints.

## Acceptance criteria

- [ ] The shared Scope request carries an Analysis-window input that is a discriminated Live or Fixed value.
- [ ] Live carries Duration and End gap in whole minutes; Fixed carries two exact UTC instants.
- [ ] One resolver turns either form into exact Start and End, and every Scope-accepting operation calls it before selecting Posts.
- [ ] Live resolves against the start of the server's current minute: at 14:32:47 a zero-gap end is 14:32:00.
- [ ] Duration is at least one minute; End gap may be zero; Duration units are exact elapsed UTC time, so a day is 24 hours and a week is 168 hours across a daylight-saving change.
- [ ] A crossed pair and a Fixed End later than the server's current minute are both rejected, not swapped, clamped or repaired.
- [ ] Fixed boundaries are normalized to zero seconds and zero milliseconds.
- [ ] A lightweight endpoint reports the server's current time so a client can estimate its offset.
- [ ] Existing callers keep working by sending the Fixed form; no second legacy interpretation of End survives.
- [ ] The generated API client is regenerated.

## Notes

The resolver is the seam AW-05 reuses to freeze an Artifact's Scope at
submission, so keep it callable from a service, not only from a route dependency.
