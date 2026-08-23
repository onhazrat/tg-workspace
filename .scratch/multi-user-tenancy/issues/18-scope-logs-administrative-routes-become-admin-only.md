# 18: Scope logs; administrative routes become Admin-only

**What to build:** A newly registered account cannot reach database statistics, table clearing, or import.

**Blocked by:** 03, 07

**Status:** ready-for-agent

- [ ] Destructive and diagnostic administrative routes require Admin
- [ ] Network logs and scheduled job records are Admin-only
- [ ] A guard asserts each administrative route rejects a non-Admin
