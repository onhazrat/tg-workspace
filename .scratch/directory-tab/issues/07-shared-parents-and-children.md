# DIR-07: Shared parents and Shared children

**What to build:** The Account picks Channels it likes and finds others like them: Channels cited
by the same Channels that cite its picks (**Shared parents**) and Channels that cite the same
places its picks cite (**Shared children**), each with its reasons. See
`.scratch/directory-tab/spec.md`: user stories 19 and 101 to 110, and the implementation decision on
Shared parents and Shared children. Variant T on `prototype/directory-tab-bars` has the editor. Both terms are in `CONTEXT.md`.

**Blocked by:** DIR-05

**Status:** ready-for-agent

The ranking the prototype measured to behave well (from its throwaway API, trimmed to the
decision):

```
shared = shared_count / sqrt(degree(candidate) * count(picks' Citing Channels or cited Channels))
```

- [ ] "Shared parents with" and "Shared children with" are Directory filter Conditions in the Filters picker's References group, each with its own picks and its own minimum shared count, defaulting to 2; the picks themselves are never results
- [ ] The picks are one of five: the Channels ticked in the list, live (re-resolved on every tick); the Channels ticked in the list as they are now, saved as typed handles; the Channels tab selection; every Follow; or typed handles. The browser resolves them to handles; the server receives handles
- [ ] The editor lists the five under "Compared with", each with its count and one line saying whether it follows later changes or stays fixed; the two ticked choices are offered only while something is ticked, and the live one is pre-selected when there are ticks
- [ ] The live ticked choice's line says that a Channel ticked while it is on leaves the results, because it is now a pick
- [ ] A saved choice reopens as "These channels" with the handles to edit
- [ ] Both read the citation pairs; sources citing more than 3,000 Channels, and targets cited by more than 3,000, are skipped as aggregators
- [ ] When both are on, a Channel must pass both
- [ ] Each adds a column with the shared count, shown only while its Condition is on, and a sort on the weighted score above
- [ ] "Why it's here" in the panel names a few of the shared Channels for each relation that is on
- [ ] The Shared children editor says that only Channels somebody follows have their own outbound References recorded, so picks nobody follows find little
- [ ] Their chips read as "2+ shared parents with the channels ticked here", "… with your selected channels", "… with your follows" or the handles, and reopen their editor; both are in the URL's text form (`parents:picked`, `parents:selection`, `parents:follows`, `children:"a b 3"`)
- [ ] A shared link whose picks are the live ticked choice counts the receiver's ticks, which start empty, as the spec's state decision says
- [ ] The Directory HTTP test module covers each relation, the minimum, both together, the weighted order, aggregators skipped and a pick never returned, from typed handles and from sent ticks, with data created by writing References
- [ ] A component render test covers the editor's five choices, their disabled states and the saved choice reopening as handles, as the CRAP ratchet requires
- [ ] Their run time with every Follow as picks is measured on a staging-sized database and written in the ticket's comments
