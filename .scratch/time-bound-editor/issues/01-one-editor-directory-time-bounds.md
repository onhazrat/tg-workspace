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
the Time bound source, No value, two wrappers, one text form). Prototype rows
"TB-01" in `../prototype.md`, pinned to 10b8c6af. ADR-033.

- [ ] Before any change, a Playwright screenshot of the Posts tab's collapsed Analysis window line and its open popover is taken on `main`; after the change both match.
- [ ] The Posts editor's existing unit tests keep every assertion (imports may change) and pass.
- [ ] The editor body, the collapsed line with popover or bottom sheet, and the zoom buttons are each one shared piece; the Posts editor uses them with no wiring beyond the Scope default.
- [ ] A Time bound source drives the same body: Start and End are instants in both modes; Duration and End gap move the ends as the spec says; a blank Start or End opens that end only where open ends are allowed; a leading `-` on End gap is accepted only where ahead is allowed; errors and drafts behave as in the Posts editor.
- [ ] No value is a third segment of the mode switch, offered only when the caller asks for it, and hides the fields while chosen.
- [ ] An empty Time bound reads "Any time".
- [ ] The Directory Time bound editor is the embedded wrapper: name, description, the spread (a bar click sets a Fixed bound), the shared editor with open ends, ahead and No value, and Add or Update with the live count. The old Live and Fixed fields are gone.
- [ ] The Time bound printer, parser and chip words live in one module used by the Directory filter (and ready for the Channel filter); every existing Directory link with a Time bound parses and prints unchanged.
- [ ] Render tests on the editor (both wrappers) cover open ends, ahead accepted and refused, No value, a shortcut, an invalid draft, and "Any time"; filter tests cover the shared text form round trip. Each new guard is mutation-tested.
