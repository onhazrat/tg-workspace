# #74 ✅ B6b: declare response models for the six families the B-series never scheduled

**State:** merged 2026-08-01 · **Branch:** `b7-retire-types-mirrors` into `main` · **Diff:** +1086 / -233 across 15 files · **Opened:** 2026-08-01

---

**A gap in the plan, not in its execution.**

B5/B6 were scoped as "`logs`+`stats`", "`jobs`+`telegram`+`network`", "`ai`+`rag`" — which quietly left **22 endpoints across six `/data` families** unassigned to any unit: setting groups, bot credentials, chat destinations, tag runs, translations, and the settings/import envelopes.

`B7` surfaced it: generated types can't be re-exported for endpoints still returning `additionalProperties: true`. So B6b comes first.

**Typed responses: 81/121 → 104/121.**

## What

`app/schemas/setting_groups.py`, `credentials.py`, `tag_runs.py`, `vectors.py`, plus `AppSettingResponse` / `ImportDataResponse` in `common.py`.

## `BotCredentialResponse` is a security boundary — demonstrated, not asserted

It's closed and carries `hasToken`, never `token`. I tested whether the *model* actually provides the protection, rather than assuming it:

| serialiser | model | result |
|---|---|---|
| normal | closed | ✅ pass |
| **leaks `token`** | closed | ✅ **pass** — the model strips it |
| **leaks `token`** | open | ❌ **fail** — it reaches the wire |

So a future serialiser change **cannot** leak the token past this model. Only editing the model can — and that's visible in review and in the generated client.

## A belief corrected by its own test

I wrote `channelCount` off as a conditional key, since `setting_group_to_camel` takes `channel_count: int | None = None`. **All three call sites supply it**, so it's always on the wire. The model still leaves it undeclared — declaring it with a default would turn a future omission into `0` rather than an absent key.

## The remaining 17 are genuinely untypeable

| category | count |
|---|---|
| SSE streams | 5 |
| binary image routes | 3 |
| streaming export | 1 |
| template utilities | 3 |
| metric blind spots (typed, uncounted) | 4 |
| `posts/counts` — precise `dict[str, int]` | 1 |

**Every domain response now has a declared model.**

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **791 passed / 2 skipped** (+7 new) |
| mypy strict | clean, 128 files |
| ruff check / format | clean |
| frontend suite | **695 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
