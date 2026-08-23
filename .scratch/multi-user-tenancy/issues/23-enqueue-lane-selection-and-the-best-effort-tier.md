# 23: Enqueue lane selection and the best-effort tier

**What to build:** A User over one Budget keeps working, more slowly, on that Budget only. Their other two Budgets are unaffected, and they still receive Posts from Channels other people sync.

**Blocked by:** 08, 12

**Status:** ready-for-agent

- [ ] Enqueue reads current usage and chooses the normal or best-effort lane
- [ ] Exhausting one Budget leaves the other two at normal priority
- [ ] Best-effort work runs only when normal work is idle
- [ ] A guard covers the ladder in both directions
