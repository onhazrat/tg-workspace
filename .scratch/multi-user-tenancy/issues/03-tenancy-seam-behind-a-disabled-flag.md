# 03: Tenancy seam behind a disabled flag (expand)

**What to build:** No user-visible change. The scoping helpers exist, are classified and registered, and generate queries identical to today's while enforcement is off, so later tickets can adopt them one batch at a time without changing behaviour.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A scoping helper, an ownership assertion, and the model classification exist
- [ ] The module is a pure transform: it builds queries and compares identifiers, executes nothing
- [ ] It is registered in the service-kind inventory, so acquiring database access later fails the suite
- [ ] The enforcement flag is read in exactly one function, asserted by a guard
- [ ] With enforcement off, generated queries are unchanged and the whole suite is green
