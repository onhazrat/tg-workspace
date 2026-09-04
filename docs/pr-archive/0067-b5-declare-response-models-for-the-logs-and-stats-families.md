# #67 ✅ B5: declare response models for the logs and stats families

**State:** merged 2026-08-01 · **Branch:** `b5-response-models-logs-stats` into `main` · **Diff:** +1863 / -150 across 10 files · **Opened:** 2026-08-01

---

Unit `B5` from `docs/architecture-simplification-plan.md` — fourteen endpoints across the `logs` and `stats` families.

**Typed responses: 53/129 → 67/129.**

## What

- `app/schemas/logs.py` — five log models plus a `LOG_SCHEMAS` registry (`log_type → schema`), the mirror of `services.logs.LOG_MODELS`. **Workstream D1 needs exactly that mapping**, so it is declared next to the shapes it describes.
- `app/schemas/stats.py` — `DbStatsResponse`, `TableSizeResponse`, `ClearTableResponse`.

A log's wire shape *is* its table: every serialiser is `{"id": …, **model_to_camel(row)}`. These models are therefore exhaustive by construction, and adding a column to a log table now fails a test instead of silently widening an untyped `dict`.

## The trap this unit found — and it bit me

The wire format is **not** mechanically derived from column names. `_CAMEL_OVERRIDES` renames a couple of dozen columns explicitly, and two are not camelisations at all:

| column | wire key | naïve guess |
|---|---|---|
| `model_config_json` | **`modelConfig`** | ~~`modelConfigJson`~~ |
| `log_type` | **`type`** | ~~`logType`~~ |

Guessing wrong does not error. The alias matches nothing on the way in, the field defaults to `None`, and the key is *renamed* on the way out — a 200 response that drops a column's value and emits a key no client has ever seen. My first draft did exactly this; it was caught only because a value assertion sat next to the key-set assertion.

**So this PR also ships `tests/api/test_schema_aliases.py`** — a package-wide sweep asserting every declared alias equals what the serialiser emits, covering new schema modules automatically. It found B1–B4 clean.

It also found one **legitimate exemption**, and I want to flag that I did *not* "fix" the model to satisfy the test: `JobsStatusResponse`'s keys are **job ids** from `JOB_IDS`, not database columns. `auto_sync` is correctly snake_case and the frontend reads `status.auto_sync?.pauseUntil`. Camelising it would break the client. That is recorded in `EXEMPT` with the reasoning.

## Two smaller corrections

- `GET /embedding-logs` declared `dict[str, Any] | list[dict[str, Any]]` — an untyped `anyOf` in OpenAPI. The service only ever returns a list.
- `LLMLogResponse` needs `protected_namespaces=()`: Pydantic v2 reserves the `model_` prefix, and this table has both a `model` column and a `model_config_json` one — the latter collides with `BaseModel.model_config` itself, so the class cannot even be declared without it.

## `PurgeLogsResponse` keeps `total` undeclared

`DELETE /data/logs` answers three call shapes with one model, and `total` is genuinely absent from two of them. It travels through `extra` rather than being declared optional (which would emit `"total": null`). Because `extra="allow"` is invisible to mypy, the route builds that response with `model_validate` rather than a keyword argument.

## Verification

| Check | Result |
|---|---|
| backend suite (isolated DB) | **759 passed / 1 skipped** |
| mypy strict | clean, 111 files |
| ruff check / format | clean |
| frontend suite | **686 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean |
| alias guard, mutation-tested | reintroducing the `modelConfigJson` bug fails **2** tests |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
