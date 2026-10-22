# KM-03: Discover, History, and acting on many

**What to build:** A Discovery report's Candidates and History's Artifacts get
keyboard mode by plugging into KM-02's engine. In a Discovery report: `j` /
`k`, counts, `gg` / `G`, `x` ticks a Candidate, `f` follows, `d` dismisses or
takes back, `o` opens it in Telegram, Enter opens Details and Esc closes them
(the Details panel stays a modal sheet, so the moves wait while it is open),
and `/` goes to the name filter. In History: the same moves, Enter opens the
Artifact in its tab, `*` stars or unstars, `n` adds or edits the note, `/` goes
to the search box, and no key deletes.

Acting on many, in the Directory and a Discovery report: `J` / `K` move and
tick, or untick when the last `x` unticked; in Posts and Channels they Pick or
select the same way. `F` follows and `D` dismisses everything ticked by pressing
the bulk bar's own buttons, keeping their confirmations (following five or more
asks first); with nothing ticked, a toast says so. `d` and `*` show a toast
naming the action and the item, with an Undo that presses the same control
again. A ticked Directory entry, a ticked Candidate and a selected Channel share
one look, a blue tint and edge; the Highlight stays the 2 px blue ring.

**Blocked by:** KM-02.

**Status:** done

**Context pointers:** spec `../spec.md` (Implementation Decisions: toasts, one
marked look; Out of Scope: Discover's Details panel), ADR-034, glossary **Tick**
(a Discovery report ticks only Candidates not yet followed), `../prototype.md`.
Prototype at a6aa1eb6:

- [DiscoverView.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/DiscoverView.tsx) and [DiscoverCandidateTable.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/discover/DiscoverCandidateTable.tsx): the Candidate list's adapter (rows, controls, Enter to Details).
- [HistoryView.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/HistoryView.tsx) and [ArtifactCardParts.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/history/ArtifactCardParts.tsx): the Artifact list's adapter, Enter to open, star and note keys.
  Since the History tab redesign (#202) these files have another shape: the adapter
  (`history/HistoryKeyboard.ts`) is called in `HistoryView.tsx` and its Highlight is
  drawn by `history/HistoryList.tsx`; `*` and `n` press `CardActions`' Star and note
  buttons in `history/ArtifactCardParts.tsx`, and the note opens in a popover.
- [fkeys.ts](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory-photo-prototype/fkeys.ts): `ensureSelection` and the last `x`'s direction, `bulkKey`, `pressControl` and its toast with Undo, `itemName`.
- [DirectoryBulkBar.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/directory/DirectoryBulkBar.tsx) and [DiscoverBulkBar.tsx](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/components/discover/DiscoverBulkBar.tsx): which buttons `F` and `D` press.
- [index.css](https://github.com/onhazrat/tg-workspace/blob/a6aa1eb6ecbef4886a48817d6228344d6ed64778/frontend/src/index.css) and the `data-selected` marks on the Channel card frames and Directory rows: the one marked look (the prototype only turned it on for C and D; it belongs everywhere).
- Not ported: toasts for `x` and `J` / `K` (decided against).
- Prior-art tests: `DiscoverCandidatePanel.test.tsx`, `DirectoryBulkBar.test.tsx`, `ArtifactCard.test.tsx`, KM-02's adapter tests.

- [ ] A Discovery report's Candidates and History's Artifacts plug into the engine through adapters; a render test per list covers the moves, Enter, each action key and the announcer.
- [ ] `x` cannot tick a followed Candidate; Enter opens and Esc closes a Candidate's Details.
- [ ] History has no delete key; `*` and `n` press star and note.
- [ ] The interpreter's table gains rows for `J` / `K` (with Shift keydowns) after an `x` that ticked and after one that unticked.
- [ ] `J` / `K` tick, select or Pick while moving in all four lists that have a selection, following the last `x`.
- [ ] `F` / `D` press the bulk bar's Follow and Dismiss in the Directory and a Discovery report, with their confirmations; with nothing ticked a toast says so.
- [ ] `d` and `*` show a toast with the action and the item, and Undo restores the item's previous state; `x` and `J` / `K` show no toast.
- [ ] A ticked Directory entry, a ticked Candidate and a selected Channel share one look in every view.
- [ ] The build and test typechecks pass, the backend suite passes, and a render test covers each new branching component.

## Comments

- 2026-10-22: implemented on `claude/km-03-discover-history-many` and merged into the integration branch in 635b756b (fast-forward).
  Open: keys wait during a closing dialog's 200 ms animation, so `F` right after Cancel does nothing; DiscoverView's `onSetIgnored` and HistoryView's star Undo have no unit render test. Both go to the integration branch's code review.
- 2026-10-22: rewired onto the History tab redesign (#202) when `origin/main` was
  merged into the integration branch; the History keyboard test now renders the real
  `HistoryList`.
