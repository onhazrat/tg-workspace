# #19 ⬆️ Upgrade backend dependencies to the template's floors

**State:** merged 2026-07-25 · **Branch:** `pr2/backend-deps` into `main` · **Diff:** +884 / -738 across 7 files · **Opened:** 2026-07-25

---

PR 2 of 7. Replaces #16, which GitHub auto-closed when its base branch `pr1/python-314` was deleted on merge of #15. Same branch, same commit (`2a84f2f`), same signed history — only the base changed to `main`.

Brings the backend dependency set up to [upstream master](https://github.com/fastapi/full-stack-fastapi-template). `starlette`, `fastapi`, `sqlmodel`, `pydantic`, `pytest` and `emails` now match upstream's **locked** versions exactly.

## Floors raised

| Package | Was | Now |
|---|---|---|
| `fastapi[standard]` | `>=0.114.2` | `>=0.139.0` (locked 0.140.0) |
| `sqlmodel` | `>=0.0.21` | `>=0.0.39` |
| `sentry-sdk` | `>=2.0.0` | `>=2.63.0` |
| `pyjwt` | `>=2.8.0` | `>=2.13.0` |
| `tenacity` | `<9.0.0` | `<10.0.0` |
| `emails` | `<1.0,>=0.6` | `>=1.1.2,<2.0` |
| `lxml` | `>=5.0.0` | `>=6.1.0` |
| `pytest` | `<8.0.0` | `>=9.0.3,<10.0.0` |
| `mypy` | `<2.0.0` | `<3.0.0` |

Transitively: **starlette 0.46.2 → 1.3.1** (major), **pytest 7.4.4 → 9.1.1** (two majors), **mypy 1.19.1 → 2.3.0** (major), numpy 2.4.6 → 2.5.1, pydantic 2.12.5 → 2.13.4.

## Preserved divergences

`httpx[socks]` + explicit `socksio` (Tor SOCKS egress), `python-dotenv` in dev (the `app_test` isolation in `tests/conftest.py` imports it), the nine extra runtime deps, and the `[[tool.mypy.overrides]]` block.

## Code changes (5 lines total)

**`app/utils.py`** — `emails` 0.6 → 1.1.2 is an API change, not a bump, and is what unblocks 3.13+ at all: `emails` 0.6 imports the removed `cgi` module. Takes upstream's fix (`emails.Message` → `emails.message.Message`, drop the now-unnecessary `type: ignore`, add the `mail_from` assert), plus a local annotation that mypy 2.x requires.

**PEP 758** — ruff 0.16 under `target-version = "py314"` rewrites `except (A, B):` → `except A, B:` in four places, including `api/deps.py`, which now matches upstream master exactly. This makes the backend syntactically **3.14-only**, which is intended given `requires-python >=3.14`.

## One deliberate pin

`ty` is held at `<0.0.55`, matching upstream's locked 0.0.54. ty 0.0.63 reports 7 diagnostics that both ty 0.0.54 **and** `mypy --strict` accept — six are the same sqlmodel scalar-select narrowing gap. Annotating those sites is real work that doesn't belong in a dependency bump; tracked as follow-up, and the pin carries a comment saying so.

## Verification

CI is billing-blocked, so all of this was checked locally.

- `mypy` strict, `ty`, `ruff check`, `ruff format --check` — clean across 99 files
- `pytest` — **500 passed, 1 skipped**. No test changes were needed for pytest 9.

### SSE through both `BaseHTTPMiddleware` layers on starlette 1.3.1

The migration's highest-consequence unknown — `BaseHTTPMiddleware` + streaming is the historically fragile combination, and six endpoints depend on it. Probed with the real `APIKeyMiddleware` plus an `@app.middleware("http")` decorator in `main.py`'s ordering:

```
SSE status=200 content-type='text/event-stream; charset=utf-8' chunks=6
first chunk @ 0.019s, last @ 1.278s, spread 1.258s
```

Five 250 ms yields spread across 1.26 s — genuinely streamed, not buffered to EOF.

- CORS preflight → **200 without auth** (CORS still outermost)
- legacy `/api/*` → **410** in production
- `APIKeyMiddleware` still fail-closed: **401** without a key on a protected route, exempt list intact

## Staging-only check

`emails` 0.6 → 1.1.2 cannot be verified locally. Its only consumer is password recovery — worth sending one real recovery email on staging after this lands.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
