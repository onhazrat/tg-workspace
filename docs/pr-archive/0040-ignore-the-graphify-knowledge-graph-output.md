# #40 🙈 Ignore the graphify knowledge-graph output

**State:** closed 2026-07-28 · **Branch:** `worktree-gitignore-graphify-out` into `main` · **Diff:** +1 / -0 across 1 files · **Opened:** 2026-07-28

---

## What

Adds `graphify-out/` to `.gitignore`.

## Why

`graphify claude install` wires PreToolUse hooks that expect a knowledge graph at `graphify-out/`. Building it with `graphify update .` produces a ~17 MB directory (`graph.json` 9.2 MB, `graph.html`, `GRAPH_REPORT.md`, `manifest.json`, plus a `cache/` dir). It is fully regenerable from the source tree with no API cost, so it does not belong in version control.

## Notes

- The graph itself was built locally and correctly respects `.gitignore` — no `node_modules`, `.venv`, or `dist` paths leaked into it (6805 nodes / 17627 edges / 372 communities from 804 source files).
- `.claude/` is deliberately left untracked-and-unignored here; whether to commit `.claude/settings.json` (which now holds the graphify hook registration) is a separate call.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Comments

### onhazrat on 2026-07-28

Superseded by #39, which already added `graphify-out/` to `.gitignore` (with an explanatory comment) as part of the full graphify setup — alongside `.graphifyignore` and the guide at `docs/graphify.md`. Closing as redundant.
