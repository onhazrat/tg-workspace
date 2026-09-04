# #112 ✨ Action tab, unified History, and workspace full-screen

**State:** merged 2026-08-20 · **Branch:** `feat/action-tab-unified-history` into `main` · **Diff:** +7865 / -1833 across 85 files · **Opened:** 2026-08-20

---

Three features, one shape: the workspace had eight tabs where every AI feature owned both its create form and its result view, and History knew about two of the four artifact kinds the app produces.

## What this does

**A full-screen mode.** One button does native Fullscreen *and* collapses the app chrome — either alone disappoints, since native fullscreen leaves an 80rem width cap and a stats strip in place. Only focus mode persists; `requestFullscreen` is refused outside a user gesture, so a reload comes back windowed. The `fullscreenchange` listener is load-bearing: Esc exits native fullscreen without touching React state, which would otherwise strand you on a chromeless page whose exit control lives in the chrome that just disappeared.

**Chats became real artifacts.** A chat was a `tg_summaries` row whose text began `"Chat: "` — the artifact's *kind* encoded in a prefix of its body text, re-derived with `str.startswith` in three places. Worse, chatting beside an open summary patched *that summary's* transcript, so the conversation never became its own row. There is no link back to a summary, because the code proved there never was one: chat mode never read a summary, it assembles its prompt from the same channels and dates a summary does.

**History is one list.** `GET /data/artifacts` unions four tables into one time-ordered page with a `kind` discriminator, server-side search and real paging. Every leg selects named columns — two of the four tables keep a corpus beside their metadata, and `select(Entity)` reads it whether the projection keeps it or not. Both existing list endpoints were doing exactly that: `list_tag_runs` detoasted every historical prompt to throw it away in Python, and `report_to_camel_light` detoasted the whole candidate array to compute a `len()`.

**An Action tab** hosting all four create forms; the feature tabs render results only. `compactWorkspaceTabs` hides them, default off — the active tab always stays visible even when compact would hide it, and nothing but the nav is ever filtered.

## Verification

| | |
|---|---|
| Backend | 1,066 tests, mypy + ruff clean |
| Frontend | 840 unit tests, **0** type errors |
| E2e | 63/65 on the affected specs |
| Migration | applied and round-tripped through downgrade |

The 2 e2e failures drive palette commands deleted in #94; `main` has zero occurrences of them.

## Two review rounds found 18 defects

A `/code-review` found 12 — three breaking shipped behaviour, one silently destroying chat transcripts. The e2e suite then found 6 more, including Apply drifting onto the wrong tab in contradiction of a decision this branch's own commit message claimed to honour.

The split is the lesson, and it matches this repo's own thesis: **the backend SQL work, which is covered by guards, came through clean.** Everything found was wiring held together by prose and attention.

## Deployment

`prestart.sh` runs the chat backfill after `alembic upgrade head`. This reverses a decision made earlier in the branch — a deploy that migrates the schema but not the data leaves every existing chat rendering as an empty summary, and a deploy is the only moment the two are guaranteed to be in step. Idempotent, keyset-paged, and reversible via the revision's downgrade; deliberately not wrapped in `|| true`.

Plan and rationale: `docs/action-tab-unified-history-plan.md`, `docs/migration/ADR-010-artifact-model.md`, and a new root `CONTEXT.md` glossary.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016Mjy4LiaHo6ZPpCcDE4QYf
