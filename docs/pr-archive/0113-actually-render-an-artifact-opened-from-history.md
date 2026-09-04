# #113 🐛 Actually render an artifact opened from History

**State:** merged 2026-08-20 · **Branch:** `fix/open-artifact-renders-body` into `main` · **Diff:** +148 / -7 across 4 files · **Opened:** 2026-08-20

---

Clicking a summary in History landed on the Summary tab and showed nothing.

## What was wrong

Two independent halves, which is why fixing one left the symptom untouched.

The **id** was arriving correctly — that was fixed after the code review, by backing `currentSummaryId` with the `?summary=` param.

The **body** was not. It rendered from `AIContext`'s `summary`, a streaming buffer that only generating or pasting ever fills. Opening a saved summary used to populate it from the restore path in `App.tsx`, and deleting that path took the mechanism with it. Nothing was a type error.

`currentSummary` had the same shape of problem: it was read out of the summaries *list*, which History no longer loads now that it lists through `/data/artifacts`. Copy and Download would have handed you an empty file.

**Chat had it too**, found by looking rather than by being told: `chatMessages` is React state nothing repopulated, so opening a saved chat showed an empty transcript. Tag was already fine — `selectedRun` has always been fetched by id.

## The fix

Both views resolve from the detail fetch keyed on the id in the URL, so they work from a URL alone and not just from a click. The chat loader keeps a ref of whose transcript is loaded, so it never refetches over turns being appended live.

## Guard

`tests/open-artifact.spec.ts` asserts what a person actually does — click the row, see the content — for both kinds that hold a body, plus the URL-alone case. Mutation-tested: removing either restore path takes it from 4 passing to 1.

840 frontend unit tests, 0 type errors.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016Mjy4LiaHo6ZPpCcDE4QYf
