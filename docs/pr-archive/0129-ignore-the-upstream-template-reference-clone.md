# #129 🧹 Ignore the upstream template reference clone

**State:** merged 2026-08-25 · **Branch:** `worktree-gitignore-template-tmp` into `main` · **Diff:** +6 / -0 across 1 files · **Opened:** 2026-08-25

---

\`git status\` has been permanently dirty on a single untracked entry: \`_template_tmp/\`.

It is a shallow clone of [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) at \`5b358ea\`, pulled 2026-06-08, 11 MB / 428 files. Because it carries its own \`.git\`, git cannot descend into it and reports the whole directory as one \`??\` line. Its working tree is clean, so nothing in it has been edited.

It is a deliberate reference, not junk. \`.cursor/plans/pre-feature_codebase_cleanup_77a87231.plan.md\` cites it about fifteen times as the source for \`.pre-commit-config.yaml\`, \`biome.json\`, the zizmor workflow, \`[tool.typos]\` and the \`generate-client.sh\` lint step, and \`docs/architecture-entropy-audit.md\` lists it under E8. It was simply never gitignored.

This ignores it and records why, plus the one-line command to re-create it. Deleting it instead stays available — the audit argues that case — but that is a separate decision, and this makes status clean either way.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
