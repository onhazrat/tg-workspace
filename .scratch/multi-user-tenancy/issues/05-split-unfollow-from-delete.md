# 05: Split unfollow from delete

**What to build:** Removing a Channel takes it off your list and leaves its Posts alone. Channels nobody Follows are collected later by retention rather than deleted on the spot.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The removal action drops the Follow, not the Channel
- [ ] Posts of the Channel are untouched by removal
- [ ] A Channel with no remaining Followers is collected by retention
- [ ] A test proves a second account's Posts survive the first account's removal
