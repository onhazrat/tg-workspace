# 10: Move the scheduler into a worker process

**What to build:** Automatic sync runs outside the web process. Restarting or deploying the API no longer interrupts syncing.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] The scheduler runs in its own process consuming the queue
- [ ] One message per Channel sync, never one per tick
- [ ] A bulk sync remains one job with aggregate progress, its messages carrying the job identity
- [ ] The web process no longer schedules work
