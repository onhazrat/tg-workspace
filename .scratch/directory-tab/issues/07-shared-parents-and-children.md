# DIR-07: Shared parents and Shared children

**What to build:** The Account picks Channels it likes and finds others like them: Channels cited
by the same Channels that cite its picks (**Shared parents**) and Channels that cite the same
places its picks cite (**Shared children**), each with its reasons. See
`.scratch/directory-tab/spec.md`: user stories 16 and 88 to 94, and the implementation decision on Shared
parents and Shared children. Both terms are in `CONTEXT.md`.

**Blocked by:** DIR-05

**Status:** ready-for-agent

The ranking the prototype measured to behave well (from its throwaway API, trimmed to the
decision):

```
shared = shared_count / sqrt(degree(candidate) * count(picks' Citing Channels or cited Channels))
```

- [ ] "Shared parents with" and "Shared children with" are Directory filter Conditions, each with its own picks (the selected Channels, every Follow, or typed handles) and its own minimum shared count, defaulting to 2; the picks themselves are never results
- [ ] Both read the citation pairs; sources citing more than 3,000 Channels, and targets cited by more than 3,000, are skipped as aggregators
- [ ] When both are on, a Channel must pass both
- [ ] Each adds a column with the shared count, shown only while its Condition is on, and a sort on the weighted score above
- [ ] "Why it's here" in the panel names a few of the shared Channels for each relation that is on
- [ ] The Shared children editor says that only Channels somebody follows have their own outbound References recorded, so picks nobody follows find little
- [ ] Their chips read as "N+ shared parents with my 20 selected" and reopen their editor; both are in the URL's text form
- [ ] The Directory HTTP test module covers each relation, the minimum, both together, the weighted order, aggregators skipped and a pick never returned, with data created by writing References
- [ ] Their run time with every Follow as picks is measured on a staging-sized database and written in the ticket's comments
