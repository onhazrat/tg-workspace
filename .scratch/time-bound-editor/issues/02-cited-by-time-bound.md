# TB-02: Cited by your channels as a Time bound

**What to build:** An Account adding or editing Cited by your channels gets
the shared editor (open ends, no ahead, no No value) in place of the day
chips, and can ask for citations in any window, Live or Fixed, such as "last
month only". The window applies to when the citing Posts were published. The
list, the count and "Why it's here" all count the same window, and "Why it's
here" states it in the chip's words ("22 Posts of your channels cite it from 2
weeks ago"). Saved links with `mine:14d` keep their meaning.

**Blocked by:** TB-01.

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (Implementation Decisions: Cited by
your channels, API contract), `../prototype.md`. Prototype at 10b8c6af, which
kept `days` beside the new fields so variant 0 still worked; this ticket
removes `days`:

- Backend: [directory.py](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/backend/app/schemas/directory.py) (`DirectoryMineCondition`, `DirectoryWhyRequest`), [directory_reads.py](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/backend/app/services/directory_reads.py) (`MineCond.when`, `_references`, `why_its_here`, `_citing_posts`), [directory.py](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/backend/app/api/routes/data/directory.py) (the Why route).
- Frontend: [DirectoryConditionEditors.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/directory/DirectoryConditionEditors.tsx) (`MineEditorV1`), [directory-filter.ts](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/lib/directory/directory-filter.ts) (the `mine` label, text and parse), [directory-panel.ts](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/lib/directory/directory-panel.ts) (`mineBound`), [DirectoryView.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/DirectoryView.tsx) (the Why request body), [DirectoryPanel.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/directory/DirectoryPanel.tsx) (`windowLabel`, use the shared chip words).
- Prior-art tests: `test_directory_browse.py`, `DirectoryConditionEditors.test.tsx`, `DirectoryPanel.test.tsx`, `directory-filter.test.ts`; Playwright `directory.spec.ts` for the mocked Directory routes.
- Regenerate the generated client after the schema change.

- [ ] The Cited by your channels Condition takes `mode`, `start` and `end` (either end open, no No value) in place of `days`; the server applies it to the citing References' timestamp as `[start, end)`, a Live end relative to now. A request carrying `days` is refused.
- [ ] The "Why it's here" request takes the same three fields in place of `days`, and its count equals the Condition's.
- [ ] The generated client is regenerated; Playwright mocks of the touched Directory routes are updated; both typechecks pass.
- [ ] The text form prints `mine:<start>..<end>` (`mine:-2w..`); `mine:14d` parses as Live from 14 days ago with an open End, and `mine:all` as no window.
- [ ] The chip and "Why it's here" read the window in the same words.
- [ ] API tests (Live and Fixed, each end open, `days` refused) in the Directory browse tests' style; filter tests for the text form; a render test for the editor in the condition menu. Each new guard is mutation-tested.
