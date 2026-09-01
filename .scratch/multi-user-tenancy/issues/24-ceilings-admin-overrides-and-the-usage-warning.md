# 24: Ceilings, Admin overrides, and the usage warning

**What to build:** An Admin sets default and per-User Budgets and sees usage. A User sees their own usage and a persistent warning when a Budget runs out.

**Blocked by:** 23

**Status:** done

- [x] Defaults and per-User overrides exist for each of the three Budgets independently
- [x] A Budget of zero means always best-effort, never blocked
- [x] An absolute per-Budget ceiling stops work entirely, lifts at the daily reset, and can be lifted early
- [x] A User sees per-Budget usage and a persistent warning when exhausted
- [x] A guard asserts zero does not mean blocked
