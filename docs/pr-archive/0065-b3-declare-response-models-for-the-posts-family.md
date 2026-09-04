# #65 ✅ B3: declare response models for the posts family

**State:** merged 2026-08-01 · **Branch:** `b3-response-models-posts` into `main` · **Diff:** +427 / -51 across 7 files · **Opened:** 2026-08-01

---

Unit `B3` from `docs/architecture-simplification-plan.md`.

**Split from the planned `posts` + `discover` unit** — together they are 17 endpoints, well past the ~600-line rule the plan sets for itself. `discover` becomes `B4`.

**Typed responses: 40/129 → 43/129.**

## What

`app/schemas/posts.py` — `PostResponse`, `BulkUpsertPostsResponse`. Applied to `POST /posts`, `POST /posts/lookup`, `POST /posts/bulk`.

## `PostResponse` is closed

No `extra="allow"`. `post_to_camel` emits exactly seventeen keys and merges nothing conditional. Worth stating plainly: **the open models are the exception in this codebase, not the pattern** — only `Summary` and `Channel` carry an open blob, and both for a documented reason.

## The same trap, one level down

`media` / `links` / `replyTo` stay loose JSON types **even though `app/schemas/post_media.py` already models the first as `PostMedia`**, and reusing it would have been the obvious move.

It would have been wrong. Media is persisted via `PostMedia.to_storage_dict()`, which uses `exclude_none=True` — so a stored blob omits its empty fields. Round-tripping it through the declared model on the way out would materialise those as explicit `null`s for every post that has media. `response_model_exclude_none` can't rescue it either: it applies to the whole response and would strip legitimate nulls from the top-level fields too.

**Declaring a nested model is only safe when the stored shape is complete.** Recorded in the plan for B4–B6.

## A shared-database hazard found while verifying

The suite first came back **`734 errors — alembic.util.exc.CommandError: Can't locate revision`**. Not my change: **every worktree under `.claude/worktrees/` shares `localhost:5432`** (whichever compose project starts first owns the published port), so nine worktrees were sharing one `app_test`, and another branch's migration had stamped `alembic_version` to a revision this branch cannot resolve.

Fixed by isolating rather than dropping — `app_test` may be in use by another worktree, and `conftest.py` already supports an override:

```bash
TEST_POSTGRES_DB=app_test_entropy uv run pytest tests/ -q
```

The plan's working rules and my earlier "run serially" note are updated: isolation is the real fix, and it partly supersedes that earlier diagnosis.

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **733 passed / 1 skipped** |
| mypy strict | clean, 108 files |
| ruff check / format | clean |
| frontend suite | **686 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean against regenerated client |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
