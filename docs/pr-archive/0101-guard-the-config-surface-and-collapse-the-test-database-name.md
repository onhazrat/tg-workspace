# #101 🔧 Guard the config surface, and collapse the test-database name

**State:** open 2026-08-02 · **Branch:** `config-guards` into `main` · **Diff:** +272 / -8 across 5 files · **Opened:** 2026-08-02

---

Answering *"are settings, env vars and constants scattered?"* needed a survey. The survey's answer is **mostly no** — with one real problem.

## What's already sound

| Layer | Where | Verdict |
|---|---|---|
| Backend env | `app/core/config.py`, 86 fields, one class | clean |
| Frontend env | `.env` → `lib/env.ts` → `constants.ts` → `settings/schema.ts` | **one spine**, clean |
| DB-backed settings | `AppSetting`, 24 keys seeded in `jobs/settings.py` | clean |
| Module constants | 133 backend / 62 frontend | **correctly colocated** |

Those 195 constants look alarming until you read them — `MAX_POST_PAGE_SIZE`, `PROXY_SLOTS_MAX`, `POST_DELETE_BATCH`. They're internal limits next to their only user. Promoting them into `Settings` would take it from 86 fields to ~280, most of which no operator should ever touch. **This PR deliberately leaves them alone**, and says so in `CLAUDE.md` so the next person doesn't "tidy" them.

## The real problem: nine tunables defaulted twice

```
RETENTION_POST_DAYS_DEFAULT=90        →  backend config.py:147
VITE_RETENTION_POST_DAYS_DEFAULT=90   →  frontend env.ts
```

Set only the first and the backend prunes at the new value while the UI keeps showing the old one. Nothing errors — the two halves just disagree.

One pair doesn't even share a name (`AUTO_SYNC_INTERVAL_MINUTES_DEFAULT` / `VITE_AUTO_SYNC_INTERVAL_DEFAULT`), so grepping for one won't find the other. And `.env.example` already documented the intent in a comment — *"mirrors DEFAULT_AI_MODEL"* — which is precisely the kind of prose #100 was about.

**This PR pins the set as a ratchet**: it may shrink, never grow, and the pairs must agree while they exist.

### Two shapes, not one

The tests distinguish something that matters more than the count. `VITE_ENVIRONMENT` **falls back** to `ENVIRONMENT`:

```ts
const deployEnvironment = env.VITE_ENVIRONMENT || env.ENVIRONMENT || ""
```

That's one source of truth with an optional override — nothing can desynchronise, because the second variable is normally unset. It's the pattern the other nine should become where a build-time value is genuinely required.

### The actual fix, deferred on purpose

`GET /api/v1/jobs/runtime-config` **already serves every one of these**, with declared models since F2 (`RetentionRuntimeSettings.postRetentionDays`, `SyncRuntimeSettings.regularSyncIntervalMinutes`, `dynamicSyncExpectedPostsDefault`). The UI is baking a second copy at build time for values the server will tell it at runtime — which is also why changing a displayed default currently needs a frontend rebuild.

That's a behaviour change (values become runtime-resolved, the UI needs a loading state it doesn't have), so it belongs in its own PR rather than hiding inside a guards change.

## Drift fixed

- `CHANNEL_IMAGE_MAX_AGE_SECONDS` and `VITE_DYNAMIC_SYNC_EXPECTED_POSTS_DEFAULT` were undocumented — added.
- Three further `Settings` fields (`API_V1_STR`, `EMAIL_TEST_USER`, `EMAILS_FROM_NAME`) are deliberately internal. That was true but unrecorded; now explicit with reasons.

## One name for the test database

`conftest.py` read `TEST_POSTGRES_DB or POSTGRES_DB_TEST` while `.env.example` documented only the second — so the documented spelling was the one you had to guess at, and parallel worktrees got set up with whichever name the last person found. Standardised on `TEST_POSTGRES_DB` across `conftest.py`, `.env.example` and `development.md`, with a note that each worktree needs its own value.

## Two bugs in my own checks, found by running them

- The first parser matched `KEY=value` inside the **indented prose block** at the top of `.env.example`, and reported `API_KEY` / `VITE_API_KEY` as disagreeing — by quoting two sentences of English at each other.
- The orphan check scanned only compose and frontend sources, so it flagged the test database (read by `conftest.py`) as a key nothing reads.

Both are now fixed and documented in the file, since both are easy to reintroduce.

## Mutation-tested

Six mutations, six caught: undocumented setting · orphaned key · undocumented `VITE_` var · a *new* duplicated pair · an existing pair drifting apart · a stale entry in the ratchet itself (which would silently license a real duplicate forever).

## Verification

- Backend **878 passed / 2 skipped**, frontend **823 pass / 0 fail**
- mypy strict, ruff check + format, `ty`, biome — clean
- All pre-commit hooks pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
