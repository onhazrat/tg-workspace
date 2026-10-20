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
your channels, API contract). Prototype row "TB-02" in `../prototype.md`,
pinned to 10b8c6af. The prototype kept `days` beside the new fields; this
ticket removes it.

- [ ] The Cited by your channels Condition takes `mode`, `start` and `end` (either end open, no No value) in place of `days`; the server applies it to the citing References' timestamp as `[start, end)`, a Live end relative to now. A request carrying `days` is refused.
- [ ] The "Why it's here" request takes the same three fields in place of `days`, and its count equals the Condition's.
- [ ] The generated client is regenerated; Playwright mocks of the touched Directory routes are updated; both typechecks pass.
- [ ] The text form prints `mine:<start>..<end>` (`mine:-2w..`); `mine:14d` parses as Live from 14 days ago with an open End, and `mine:all` as no window.
- [ ] The chip and "Why it's here" read the window in the same words.
- [ ] API tests (Live and Fixed, each end open, `days` refused) in the Directory browse tests' style; filter tests for the text form; a render test for the editor in the condition menu. Each new guard is mutation-tested.
