# 21: Enable enforcement and prove isolation (integrate)

**What to build:** Two real accounts genuinely cannot see each other. This is the acceptance gate for the whole tenancy programme.

**Blocked by:** 15, 16, 17, 18, 19, 20

**Status:** ready-for-agent

- [ ] Owner columns are non-null with real cascading keys, added without exclusive locks on large tables
- [ ] An isolation test parametrised over the whole mounted route inventory passes for two accounts
- [ ] Another account's row returns not-found on read, update, and delete
- [ ] Deleting an account cascades its rows while shared Channels and Posts survive
- [ ] The single-operator helper and its null-owner fallback are deleted
- [ ] Two existing tests encoding single-operator behaviour are inverted, not deleted
- [ ] The suite is green with enforcement both off and on
