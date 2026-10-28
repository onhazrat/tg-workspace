# TGU-03: The Tags dropdown in the Directory and on the Requests tab

**What to build:** The Directory and the Requests tab's Channels by Requests get the Channels tab's Tags dropdown: select, name, rename, delete, count, filter, ordered by that tab's Tag uses. Selecting a Tag adds its Channels to the tab's own selection (the Directory selection; the Requests selection, where unselecting takes rows out of every total). Filtering adds a Tag Condition, two in one dropdown meaning either. Counts come from one call when the dropdown opens. Both tabs say select / selected / Select all. Spec: user stories 1, 4 to 11, 23, 44 and 45, and "The shared dropdown" and "Words".

**Blocked by:** TGU-02

**Status:** ready-for-agent

- [ ] One Tags dropdown component wraps `FacetMenu` for both tabs, given the tab, its scope (every Channel for the Directory; the table's Channel rows for the Requests tab), its selection and how to change it, and its Tag Conditions. It reads TGU-02's route once per open and lists no Tag with none of the tab's Channels.
- [ ] Selecting a Tag fetches that one Tag's handles and adds them to, or removes them from, the tab's selection; nothing fetches every Tag's handles. Each select and filter records a Tag use for the tab.
- [ ] Directory: the dropdown sits in the bar after Language and replaces the old Tags menu. Filtering by Tags writes `tag:` Conditions on the top-level AND, two or more as one OR group. The Tag picker (row, panel, bulk bar), the Filters' Tag options and the Seeds' Tag choice follow the Directory's order, and tagging, untagging and choosing a Tag as Seeds record a use.
- [ ] Requests tab: the dropdown sits after Kinds. The Requests tab's channel filter gains a Tag Condition matching a row whose handle the Tag carries, fetched per filtered Tag and standing aside while loading; the filter row offers "In the Tag" with the Requests tab's order.
- [ ] Words: the Directory's "N ticked" reads "N selected"; the Requests tab's "N Channels left out · Pick all" reads "N Channels unselected · Select all"; the dropdown headers say select. Code identifiers keep their names.
- [ ] Component seam tests on the shared dropdown: selection calling the tab's change with the Tag's members, counts and ticks from the read, empty Tags not listed, the filter's either-of semantics. Pure-module cases for the Requests tab's Tag Condition and the Directory filter's Tag OR group. Each mutation-checked, named in the commit body.
- [ ] Lint, typecheck and the full frontend suite pass; the Playwright mocks touching these bars are updated.
