# TGU-04: Setting groups apart from Tags, with a gear

**What to build:** Setting groups stop posing as Tags. No Tags list shows a `group:` name. The Directory and the Requests tab get the Channels tab's Groups dropdown, and every Groups row on all three tabs has a gear, left of its count, that opens that Setting group in Settings. In the Directory a Setting group is a Condition and a Seed source of its own, matching only followed entries, and old `tag:"group:<name>"` links still read. The Requests tab's filter gains a Setting group Condition. Spec: "Setting groups", user stories 30 to 36.

**Blocked by:** TGU-03

**Status:** ready-for-agent

- [ ] No Tags dropdown or Tag picker on any tab lists a `group:` name; the Tag list route may still return them for old callers.
- [ ] Every Groups row on the Channels tab, the Directory and the Requests tab has a gear between its name and its count, opening Settings at the Setting groups panel with that group open.
- [ ] Directory: a Groups dropdown after Tags; selecting a group adds its followed Channels to the Directory selection; filtering adds a Setting group Condition. The Directory filter has the Setting group Condition (by name in the URL form, as the Channel filter's), resolved on the server to the reader's Follows in that group, and a Setting group Seed source for Shared parents, Shared children, Cited by and Cites. The parser reads `tag:"group:<name>"` as the Setting group Condition.
- [ ] Requests tab: a Groups dropdown after Tags; selecting a group puts its rows in the Requests selection; filtering adds a Setting group Condition to the tab's channel filter.
- [ ] API seam tests: the Setting group Condition and Seed source in the Directory, matching only the reader's Follows, and an old `group:` Tag link answering the same. Pure-module cases: the Directory filter parsing and printing the Condition and the old form, the Requests tab's Setting group Condition. A component check that the gear sits left of the count. Each mutation-checked, named in the commit body.
- [ ] Lint, typecheck, the route guards and the full backend and frontend suites pass.
