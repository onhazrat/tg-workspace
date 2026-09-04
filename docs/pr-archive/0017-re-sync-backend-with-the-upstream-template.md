# #17 ♻️ Re-sync backend with the upstream template

**State:** merged 2026-07-25 · **Branch:** `pr3/template-resync` into `main` · **Diff:** +994 / -763 across 15 files · **Opened:** 2026-07-25

---

PR 3 of 7. **Stacked on #16** (which is stacked on #15) — bases retarget as each merges.

Picks up the remaining substantive template changes since the fork point (`38302d7`). Much of the convergence already happened in #15/#16 via the ruff `py314` autofixes, so what's left is the models refactor and the tooling moves.

## `app/models.py` — upstream [`77be7243`](https://github.com/fastapi/full-stack-fastapi-template/commit/77be72439c33aba002198b1dc8e6dbb3c2372d69), taken wholesale

`UserUpdate` and `ItemUpdate` now derive from `SQLModel` with explicitly optional fields, rather than inheriting from `UserBase`/`ItemBase`. Drops two `# type: ignore[assignment]` comments.

**The file is now byte-identical to upstream master.**

## Tooling, matching upstream

- `backend/pyproject.toml` gains `[tool.fastapi] entrypoint = "app.main:app"`
- `prek` moves from the backend dev group to the root one ([`54de7563`](https://github.com/fastapi/full-stack-fastapi-template/commit/54de7563)) — verified it resolves from there
- `zizmor` floor → `>=1.25.2`
- `typos` pre-commit hook `v1.46.0` → `v1.48.0`, keeping our `--config _typos.toml`
- `.github/workflows/bump-pre-commit-hooks.yml` added ([`349a7537`](https://github.com/fastapi/full-stack-fastapi-template/commit/349a7537))

## Preserved divergences

The auth status codes in `api/deps.py` (403→401, 404→401, 400→403), the ~85 project settings appended to `core/config.py`, `httpx[socks]`/`socksio`, `python-dotenv`, and our extra typos excludes and pre-commit hooks.

## Generated client — regenerated once

Deliberately regenerated here, on the settled backend, rather than in each preceding PR (FastAPI 0.139 and the models refactor both move `openapi.json`; doing it twice would produce one large diff of pure noise).

The only change is `UserUpdate.is_active` / `.is_superuser` becoming nullable — mirroring upstream's own client diff exactly.

## Deliberately skipped

Upstream's library-skills commit (`8c6e31a8`) tracks `.claude/skills/`. Our `.claude/` is untracked **and not gitignored**, so adopting it risks committing `settings.local.json` and `worktrees/`. Zero runtime impact.

## The Dockerfile CMD is a separate commit

`505c97b` drops the explicit `app/main.py` argument ([`119e31fb`](https://github.com/fastapi/full-stack-fastapi-template/commit/119e31fb)). It's split out because it is **the only line in this entire migration that changes production behaviour**, so it can be reverted surgically.

Rather than leave it as a staging-only check, it was verified end-to-end by running the built image against a live database:

```
🐍 Using import string: app.main:app
🌐 Server started at http://0.0.0.0:8000
health-check -> 200
```

## Verification

- `mypy` strict, `ty`, `ruff check`, `ruff format --check` — clean across 99 files
- `pytest` — **500 passed, 1 skipped**
- `bunx tsc -p tsconfig.build.json --noEmit` — clean, so the `UserUpdate` optionality flip did not break `UserSettings/UserInformation.tsx` (the file flagged as at-risk)
- `biome check` clean
- `prek` and `zizmor` resolve from the root workspace after the move

🤖 Generated with [Claude Code](https://claude.com/claude-code)
