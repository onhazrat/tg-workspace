# 08: Quota ledger, Request counting, observe only

**What to build:** An Admin can see how many Requests each User consumed today, per Budget. Nothing is throttled; this is measurement before enforcement.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The ledger records one row per User, per day, per Budget
- [ ] Requests reaching Telegram are counted, including error responses; retries and transport failures are not
- [ ] Counting happens at sync completion, charging the actual Request count
- [ ] Ledger rows are never pruned
- [ ] An Admin view shows per-User usage
