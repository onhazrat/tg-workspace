# 06: Split global and per-user settings

**What to build:** Deployment settings and personal settings live apart. Scheduler state stops being something any User can overwrite. No visible change yet.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Global settings and per-User settings are separate tables with distinct keys
- [ ] Scheduler runtime state moves to the global table
- [ ] All writers thread the owner; a guard asserts no global key is written to the per-User table or the reverse
- [ ] The data move is behaviour-neutral and safe to run unattended
