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

- [x] "Shared parents with" and "Shared children with" are Directory filter Conditions in the Filters picker's References group, each with its own picks and its own minimum shared count, defaulting to 2; the picks themselves are never results
- [x] The picks are one of five: the Channels ticked in the list, live (re-resolved on every tick); the Channels ticked in the list as they are now, saved as typed handles; the Channels tab selection; every Follow; or typed handles. The browser resolves them to handles; the server receives handles
- [x] The editor lists the five under "Compared with", each with its count and one line saying whether it follows later changes or stays fixed; the two ticked choices are offered only while something is ticked, and the live one is pre-selected when there are ticks
- [x] The live ticked choice's line says that a Channel ticked while it is on leaves the results, because it is now a pick
- [x] A saved choice reopens as "These channels" with the handles to edit
- [x] Both read the citation pairs; sources citing more than 3,000 Channels, and targets cited by more than 3,000, are skipped as aggregators
- [x] When both are on, a Channel must pass both
- [x] Each adds a column with the shared count, shown only while its Condition is on, and a sort on the weighted score above
- [x] "Why it's here" in the panel names a few of the shared Channels for each relation that is on
- [x] The Shared children editor says that only Channels somebody follows have their own outbound References recorded, so picks nobody follows find little
- [x] Their chips read as "2+ shared parents with the channels ticked here", "… with your selected channels", "… with your follows" or the handles, and reopen their editor; both are in the URL's text form (`parents:picked`, `parents:selection`, `parents:follows`, `children:"a b 3"`)
- [x] A shared link whose picks are the live ticked choice counts the receiver's ticks, which start empty, as the spec's state decision says
- [x] The Directory HTTP test module covers each relation, the minimum, both together, the weighted order, aggregators skipped and a pick never returned, from typed handles and from sent ticks, with data created by writing References
- [x] A component render test covers the editor's five choices, their disabled states and the saved choice reopening as handles, as the CRAP ratchet requires
- [x] Their run time with every Follow as picks is measured on a staging-sized database and written in the ticket's comments

## Comments

- **Wire.** One Condition shape for both: `{type: "parents" | "children", handles, min}` (`min` 1 to 10,000, default 2; up to 10,000 handles, none matches nothing). The browser keeps `picks` (`picked`, `selection`, `follows`, `handles`) in its own Condition and `directoryFilterBody(filter, sets)` swaps it for handles on every read, so the live ticked choice follows the ticks. List rows gain `sharedParents` / `sharedChildren` (`null` while that relation is off; the first such Condition in the tree is the one the column, sort and Why read). Sorts `shared_parents` / `shared_children`. `POST /directory/why` takes optional `parents` / `children` picks and answers `parents` / `children: {channels (5, most References first), total} | null`. No new route.
- **Aggregators** are the middle Channels: a source citing more than 3,000 (parents), a target cited by more than 3,000 (children). The picks are left out as middle Channels too, as the prototype did.
- **Weighted score** is `shared / sqrt(degree(candidate) * |middle Channels|)` as specified; the second factor is the same for every row of one read, so it changes no order, only the number, which is not shown.
- **Picks never results** holds for the Condition itself. Negated (`not parents:...`) it passes everything it does not match, picks included; that seemed right for a NOT and needs no extra code.
- **"From sent ticks".** The server cannot tell ticks from typed handles (both arrive as handles), so the HTTP module covers typed handles and the empty-picks case (a shared link opened with no ticks), and the Playwright test covers the ticks being sent live, a ticked Channel leaving the list, and a shared link counting the receiver's empty ticks.
- **Reference kinds** do not narrow either relation (the pairs keep no kinds, as the spec says), nor its Why line.
- The two count columns are not in the Columns menu: they show exactly while their Condition is on, so there is nothing to hide.
- The text form reads a typed handle spelled like a source word (`follows`, `picked`, `selection`) as that source. Telegram allows such handles; flagged with a `ponytail:` comment.
- **Run time** on local `app_staging_proto` (3.33M References, 1,722,025 pairs, the Account with most follows: 282 as picks), through `directory_reads.list_page` under the opening view, counts cache cleared before each read (database buffers warm). Parents: 0.52 s (sort Yours), 0.39 s (weighted sort), 220 results. Children: 0.56 s and 0.74 s, 456 results. Both: 0.57 s, 10 results. Why's shared line 18 ms. That copy predates DIR-04, so the two citation tables were created and filled for the run (17.7 s) and dropped after, and the view was built by hand (no `tg_dismissals` there).
- The Playwright steps are their own short test (`compare with the channels ticked here, live, and open it as a link`), as the journey sits near CI's 30 s budget.
