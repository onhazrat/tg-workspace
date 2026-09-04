# #70 ♻️ C1: split the data.py god-router into one module per resource family

**State:** merged 2026-08-01 · **Branch:** `c1-split-data-router` into `main` · **Diff:** +2186 / -1866 across 19 files · **Opened:** 2026-08-01

---

Workstream `C` from `docs/architecture-simplification-plan.md`, done as **one** unit rather than the planned C1–C5.

## Why one unit, not five

The split is only behaviour-preserving if it happens at once. A half-split module can't be verified by the OpenAPI diff — and that diff is the entire safety argument for the change.

## What

`routes/data.py` (**1,453 LOC, 73 endpoints, 14 families**) → `routes/data/`:

| module | LOC |
|---|---|
| `channels.py` | 425 |
| `discover.py` | 292 |
| `logs.py` | 202 |
| `admin.py` | 172 |
| `summaries.py` | 156 |
| `posts.py` | 118 |
| `credentials.py` | 99 |
| `vectors.py` | 71 |
| `_shared.py` | 38 |
| `__init__.py` | 40 |

The six inline `BaseModel`s moved to `app/schemas/posts.py` and `app/schemas/discover.py` — **no route module declares a model any more**, finishing B1's rule.

## The result to check

`frontend/openapi.json` is **identical order-insensitively**: 304 insertions, 304 deletions, all of it path-key reordering. Same 129 operations, same operation ids, same component schemas.

Operation ids are `{tag}-{function_name}`, so keeping the tag `data` and every function name identical is what makes that hold.

## It went wrong first, and quietly — worth reading

The initial extraction took each function's span from the `ast` node's `lineno`. **That points at the `def`, not the decorator.** So every block boundary orphaned its leading `@router.…` and **twelve endpoints silently disappeared** — exactly one per extracted range.

They still imported. They still type-checked. **698 of 767 tests still passed.** Nothing named the twelve except the OpenAPI diff.

The rewrite addresses functions **by name**, derives spans from `decorator_list` upward, and refuses to run if any top-level definition is left unassigned.

## So this also ships a guard

`tests/api/test_route_inventory.py` parses the route modules and asserts:

1. every declared `@router.…` route is actually mounted;
2. no module declares routes without being `include_router`'d;
3. the count is still 73.

Mutation-tested against both real failure modes:

| Mutation | Result |
|---|---|
| orphan a module's first decorator (the original bug) | **1 test fails** |
| drop an `include_router` line | **3 tests fail** |

> **Two stale figures corrected.** The plan and audit both say "71 endpoints" and "1,438 LOC". Measured: **73** and **1,453**. The test asserts the measured number.

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **770 passed / 2 skipped** (767 + 3 new) |
| mypy strict | clean, 124 files |
| ruff check / format | clean |
| `tsc -p tsconfig.build.json` | clean |
| OpenAPI diff | ordering-only; 129 ops, ids and schemas unchanged |

`CLAUDE.md` updated: the `/data` package layout, the operation-id coupling to function names, and the `AppSetting` third-writer note now pointing at `routes/data/admin.py`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
