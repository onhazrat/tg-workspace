# TB-01: One editor, Directory Time bounds on it

**What to build:** An Account editing a Time bound on a Directory moment (Last
post, Found and the others) gets the Posts tab's Analysis window editor inside
the condition menu: Live | Fixed | No value, Start, End, Duration, End gap and
the elapsed shortcuts, with the moment's spread above and Add or Update with a
live count below. Clearing Start or End leaves that end open, and a negative
End gap (`-2d`) ends ahead of now. The Posts tab's own Analysis window editor
looks and behaves exactly as it does today.

This ticket is the prefactor every other ticket stands on: the Analysis window
editor split into its body, the collapsed line with its popover or sheet, and
the zoom buttons; the body reading through a source whose default is the
Scope; a Time bound source with open ends, ahead and No value; and one Time
bound text form shared by the Directory and Channel filters.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (Implementation Decisions: the editor,
the Time bound source, No value, two wrappers, one text form), ADR-033,
`../prototype.md`. Prototype at 10b8c6af, port and rename out of
`time-bound-prototype/`, dropping every `useIsVariant1` gate:

- [AnalysisWindowControl.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/AnalysisWindowControl.tsx): the source type and context, `WindowEditor` with `modeLabel` and `noValue`, `WindowOverlay`, `ZoomControls`. Everything else in the file is `main`'s and must not change.
- [TimeBoundEditor.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/time-bound-prototype/TimeBoundEditor.tsx): `useTimeBoundSource` (field mapping, open ends, ahead, drafts), `TimeBoundEditor` (embedded), `TimeBoundBar`, `timeBoundSummary`, `resolveTimeBound`, `inTimeBound`.
- [directory-filter.ts](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/lib/directory/directory-filter.ts): `END`, `endValue`, `instantText`, `offsetText`, `timeBoundWords`, exported there in the prototype; move them into their own module.
- [DirectoryTimeEditor.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/directory/DirectoryTimeEditor.tsx): the variant-1 branch, which becomes the only branch.
- Not ported: `variant.tsx`, the `?variant=` wiring in the app shell and the workspace search, the Vite proxy entries, `backend/scripts/proto_time_bound_api.py`.
- Today's code it builds on: the Scope context (drafts, debounce, the server minute clock) and the Scope window rules (elapsed and local-minute parsing and formatting, the error messages).
- Prior-art tests: `AnalysisWindowControl.test.tsx`, `ScopeContext.test.tsx`, `lib/scope/window.test.ts`, `DirectoryTimeEditor.test.tsx`, `directory-filter.test.ts`.

- [x] The ticket's first commit, on unchanged code, adds a markup snapshot test of the Posts tab's collapsed Analysis window line and its open popover (desktop and the phone sheet); every later commit passes it without updating the snapshot. Optionally, compare a local Playwright screenshot before and after; it is not committed, since CI renders on another platform.
- [x] The Posts editor's existing unit tests keep every assertion (imports may change) and pass.
- [x] The editor body, the collapsed line with popover or bottom sheet, and the zoom buttons are each one shared piece; the Posts editor uses them with no wiring beyond the Scope default.
- [x] A Time bound source drives the same body: Start and End are instants in both modes; Duration and End gap move the ends as the spec says; a blank Start or End opens that end only where open ends are allowed; a leading `-` on End gap is accepted only where ahead is allowed; errors and drafts behave as in the Posts editor.
- [x] No value is a third segment of the mode switch, offered only when the caller asks for it, and hides the fields while chosen.
- [x] An empty Time bound reads "Any time".
- [x] The Directory Time bound editor is the embedded wrapper: name, description, the spread (a bar click sets a Fixed bound), the shared editor with open ends, ahead and No value, and Add or Update with the live count. The old Live and Fixed fields are gone.
- [x] The Time bound printer, parser and chip words live in one module used by the Directory filter (and ready for the Channel filter); every existing Directory link with a Time bound parses and prints unchanged.
- [x] Render tests on the editor (both wrappers) cover open ends, ahead accepted and refused, No value, a shortcut, an invalid draft, and "Any time"; filter tests cover the shared text form round trip. Each new guard is mutation-tested.
