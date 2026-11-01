# Codex worktrees

Codex's local environment at `.codex/environments/environment.toml` runs
`bash scripts/codex-worktree-setup.sh` when creating a worktree. The same command
repairs incomplete setup and preserves existing port assignments. Commit these
files before starting worktrees from a branch that should include this setup.

The script links the main checkout's `.env`, installs locked Python and Bun
dependencies, and creates and migrates separate pytest and seeded API databases.
Database names include a hash of the full worktree path. `.env.worktree` supplies
the existing pytest and Playwright configuration; it contains no credentials.
Keep one pytest process per worktree database.

The **API** and **Frontend** actions start servers in this checkout. The API uses
the seeded database, and the frontend proxies to that API. API and frontend ports
are reserved across registered worktrees and checked before launch. A conflicting
server causes a launch error rather than silently selecting another port.

Run `bash scripts/codex-worktree-setup.sh --teardown` before discarding a worktree
to drop its two databases. The script refuses the main checkout and refuses to
overwrite a `.env.worktree` created by another setup. Setup and teardown share a
repository-local lock; existing worktrees and their servers stay untouched.

Claude continues using `scripts/worktree-setup.sh` and its own launch configuration.
The Codex setup does not write `.claude/launch.json` or change Claude's database
names or ports.
