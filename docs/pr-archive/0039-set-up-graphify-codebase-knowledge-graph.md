# #39 📝 Set up graphify codebase knowledge graph

**State:** merged 2026-07-28 · **Branch:** `worktree-graphify-setup` into `main` · **Diff:** +369 / -0 across 4 files · **Opened:** 2026-07-28

---

Sets up [graphify](https://github.com/Graphify-Labs/graphify) for this repo — a tool that turns the codebase into a queryable knowledge graph (tree-sitter ASTs locally, LLM only for prose docs).

**Built and verified end to end**, not just configured.

## What's here

- **`.graphifyignore`** — extra exclusions on top of `.gitignore`: lock files, the generated `frontend/src/client/`, alembic revisions, `TG-Summarizer/`, and `.claude/` (worktrees under it are full repo copies and would duplicate every node). Verified: zero nodes came from any excluded path.
- **`.gitignore`** — `graphify-out/` ignored. Backed by measurement: the artefacts are large (`graph.json` 7.4 MB, `graph.html` 5.7 MB) and rebuild from source in ~14 s. The guide documents how to opt into committing it (needs the union merge driver, or `graph.json` conflicts on every rebuild).
- **`docs/graphify.md`** — step-by-step guide, linked from `docs/README.md`.

## Measured on this repo (graphify 0.9.28)

| | |
|---|---|
| Code files indexed | 691 |
| Graph | 4,840 nodes, 15,042 edges, 233 communities |
| Wall time, code-only path | ~14 s |
| Top hubs | `cn()` (165 edges), `Channel` (80), `CommandContext` (76), `Post` (69), `utc_now()` (68) |

The guide corrects a few things the upstream README implies:

- `query` returns a **subgraph as LLM context, not a prose answer** — broad questions blow the token budget (the sample question matched 637 nodes, truncated to 27). `path` and `explain` are the human-readable ones, and they cite `file:line` per edge.
- The "first build is slow" caveat doesn't apply on the code-only path here.
- Community **naming** is a separate, paid LLM pass (`graphify label`); the free AST pass leaves them as `Community 124`.
- graphify auto-skips files that look secret — it skipped `.env.example` here, which is the desired behaviour.

## Not included, on purpose

- graphify is **not** added to `pyproject.toml` — it's a per-machine dev tool (`uv tool install graphifyy`) and must not land in the backend image.
- `graphify claude install` (which appends to the checked-in `CLAUDE.md` and adds a `PreToolUse` hook) was **not** run. It's flagged in the guide as a team decision rather than a personal one. Plain `graphify install` writes only to `~/.claude/` and the global `~/.claude/CLAUDE.md`.
- Communities are currently unnamed, since no API key is configured. Running `/graphify .` from a Claude Code session names them through the existing session.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
