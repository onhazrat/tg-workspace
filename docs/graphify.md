# Graphify — codebase knowledge graph

[Graphify](https://github.com/Graphify-Labs/graphify) turns this repo into a queryable
knowledge graph. It parses source with tree-sitter (deterministic ASTs, **no LLM, fully
local**), then uses your AI assistant only for the *prose* — Markdown docs, ADRs, PDFs —
and finally clusters everything into subsystems.

The point: instead of grepping across `backend/app/services/` and `frontend/src/` to
answer "what actually touches channel sync?", you ask the graph and get a traced path
with real edges.

Every edge is tagged `EXTRACTED` (read literally out of the source) or `INFERRED`
(resolved/derived), so you can tell what the tool *knows* from what it *guessed*.

---

## 1. Install the CLI (one-time, per machine)

Requires Python 3.10+. The package name is `graphifyy` (three y's — the binary is
`graphify`).

```bash
uv tool install graphifyy
```

`pipx install graphifyy` or `pip install graphifyy` also work; `uv tool` is preferred
because it keeps graphify in its own environment and off this repo's `.venv`.

**Do not add graphify to `pyproject.toml`.** It is a developer tool, not a runtime
dependency — it must not land in the backend image.

Verify:

```bash
graphify --version
```

### Optional extras

Plain install covers all source code and Markdown, which is everything this repo needs.
Add extras only if you start feeding it other material:

```bash
uv tool install "graphifyy[pdf]"      # PDF ingestion
uv tool install "graphifyy[office]"   # .docx / .xlsx
uv tool install "graphifyy[all]"      # everything
```

---

## 2. Register the `/graphify` skill (one-time, per machine)

```bash
graphify install
```

This auto-detects your assistant and writes to your **home** directory:

- `~/.claude/skills/graphify/SKILL.md` (+ a `references/` dir)
- a short registration block appended to your **global** `~/.claude/CLAUDE.md`

Nothing is written into this repo, and nothing is committed. The project's checked-in
`CLAUDE.md` is not touched.

Useful variants:

| Command | Effect |
|---|---|
| `graphify install --platform claude` | Force the Claude Code target instead of auto-detect |
| `graphify install --project` | Install into `./.claude/skills/` instead of `~/.claude/` — commit it so teammates get the skill automatically |
| `graphify uninstall` | Remove graphify from every detected assistant |
| `graphify uninstall --purge` | …and delete `graphify-out/` too |

Restart (or `/exit` and reopen) Claude Code so the new skill is picked up.

> `graphify claude install` is a **different, more invasive** command: it appends a
> graphify section to `CLAUDE.md` and registers a `PreToolUse` hook that nudges the
> assistant toward the graph before it greps. It edits a file that is checked in here,
> so treat it as a team decision, not a personal one. Plain `graphify install` is enough
> to use the tool.

---

## 3. Build the graph (first run)

From the repo root, inside your assistant:

```
/graphify .
```

This walks every source file, then hands the prose (Markdown, ADRs) to your assistant for
semantic extraction. It writes everything to `graphify-out/`:

| File | What it is |
|---|---|
| `graph.html` | Interactive force-directed visualisation. Open it in a browser. |
| `GRAPH_REPORT.md` | Human-readable summary: key concepts, detected subsystems, suggested questions. **Read this first.** |
| `graph.json` | The full graph. Everything below queries this file. |

`graphify-out/` is **gitignored** in this repo (see §7 if you want to change that).

### Flags worth knowing

```
/graphify . --update          # re-extract only files that changed (fast; use this daily)
/graphify . --cluster-only    # rerun subsystem detection on the existing graph
/graphify . --no-viz          # skip graph.html — faster, good for CI
```

### Building without an assistant

If you want code structure only and no LLM in the loop at all:

```bash
graphify extract . --code-only     # AST pass: writes graph.json
graphify cluster-only . --no-label # subsystems + GRAPH_REPORT.md + graph.html
```

Pure AST, no API key required, nothing leaves the machine. Measured on this repo
(2026-07-28, graphify 0.9.28):

| | |
|---|---|
| Code files indexed | 691 |
| Docs skipped by `--code-only` | 118 |
| Result | **4,840 nodes, 15,042 edges, 233 communities** |
| Wall time | **~14 s** |

So the "first build is slow" warning does not really apply here on the code-only path —
it's fast enough to run whenever. The expensive part is only the semantic doc pass.

Two things it does on its own, worth knowing:

- **It refuses to index files that look secret.** On this repo it skipped `.env.example`
  and `reset_password.mjml` as "potentially sensitive". That's the desired behaviour —
  don't override it.
- **Pure-data files produce nothing.** ~27 files (`launch.json`, `settings.json`, VS Code
  config, fixture JSON) yield zero nodes and are simply absent from the graph.

### Naming the subsystems

The AST pass can find communities but can't *name* them — the report will say
`Community 124` rather than "channel sync pipeline". Naming needs one LLM pass:

```bash
graphify label .                  # name every community
graphify label . --missing-only   # keep existing names, fill gaps only
```

This is the one step that costs something. It picks a backend from whatever key is set
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) or a local `OLLAMA_BASE_URL`. Running
`/graphify .` from inside Claude Code does this through your existing session instead,
which is usually the cheapest route.

---

## 4. Query it

These are plain CLI commands — no assistant needed. Run them from the repo root; they
default to `graphify-out/graph.json`.

```bash
# Open-ended question, answered by BFS traversal of the graph
graphify query "what connects the sync orchestrator to the scheduler?"
graphify query "how does an AI provider get selected at request time?"

# Shortest path between two entities — the killer feature
graphify path "SyncOrchestrator" "AppSetting"
graphify path "DataContext" "sync_orchestrator"

# Plain-language description of one node and its neighbours
graphify explain "proxy_pool"

# Blast radius: what breaks if I change this?
graphify affected "Settings" --depth 3

# Architectural hubs — the most-connected nodes ("god nodes")
graphify god-nodes --top 15
```

Handy flags: `--budget N` caps `query` output at N tokens (default 2000);
`--depth N` and `--relation R` tune `affected`; `--json` makes `god-nodes`
machine-readable.

### What the output actually looks like

Set expectations correctly, or you'll be disappointed:

- **`query` does not answer in prose.** It runs a BFS from the nodes matching your
  question and prints the matching subgraph as `NODE`/edge lines. It is *context for an
  assistant*, not an answer for a human. Broad questions blow the token budget fast — the
  question above matched 637 nodes and got truncated to 27 at the default budget. Narrow
  the question or raise `--budget`.
- **`path` and `explain` are the ones you read directly.** They're precise and cite
  `file:line` for every edge, tagged `EXTRACTED` vs `INFERRED`. `explain "proxy_pool"`
  returns all 17 connections with exact source locations.
- **`path` warns on ambiguous matches.** If two nodes score identically it says so and
  picks one — use a more specific name (`ProxyPoolManager`, not `proxy`) when you see it.

For reference, the hubs in this repo today are `cn()` (165 edges), `Channel` (80),
`CommandContext` (76), `Post` (69), and `utc_now()` (68) — which is a fair summary of
where gravity sits in the codebase.

### Why this beats grep here

This repo has two deliberate splits that text search handles badly and a graph handles
well — `app/models.py` vs `app/models_tg.py`, and the hand-written `frontend/src/api/`
vs the generated `frontend/src/client/` (ADR-006). `graphify path` shows you which side
of each split a given flow actually goes through.

---

## 5. Keep it fresh

Manual, after a chunk of work:

```
/graphify . --update
```

Automatic, on every commit:

```bash
graphify hook install     # post-commit + post-checkout git hooks
graphify hook status
graphify hook uninstall
```

The hook rebuild is the AST-only path, so it is fast and never calls an LLM. It is a
local git hook — it is not committed and does not affect teammates.

> Heads up if you use worktrees: this repo keeps Claude Code worktrees under
> `.claude/worktrees/`, which `.graphifyignore` excludes. Rebuild from the **main**
> checkout so the graph describes `main`, not a feature branch.

---

## 6. Export views

```bash
graphify export callflow-html   # Mermaid architecture / call-flow diagram
graphify tree                   # collapsible D3 tree → graphify-out/GRAPH_TREE.html
graphify benchmark              # token savings vs. dumping the whole corpus at an LLM
```

---

## 7. Repo configuration

Two files were added for this project.

### `.graphifyignore`

Same syntax as `.gitignore`; `.gitignore` itself is honoured automatically, so this file
only lists the *extra* exclusions. It skips, and why:

- `graphify-out/` — never feed the graph back into itself
- `.claude/` — worktrees under it are full repo copies and would duplicate every node
- `uv.lock`, `bun.lock` — ~500 KB of generated pins, zero architecture
- `frontend/src/client/`, `frontend/openapi.json` — generated, never hand-edited; the
  hand-written `frontend/src/api/` is the one worth mapping
- `backend/app/alembic/versions/` — one near-identical module per migration (already
  excluded from lint and type-check for the same reason)
- `TG-Summarizer/` — parity reference for the pre-migration app, absent from most clones
- test reports and tool caches

Loosen it if you want migrations or the generated client in the graph. Verified on the
first build: **zero** nodes came from any excluded path.

### `.gitignore`

`graphify-out/` is ignored, for two measured reasons: the artefacts are large
(`graph.json` 7.4 MB, `graph.html` 5.7 MB) and the whole thing rebuilds from source in
~14 s. Committing it mostly buys merge conflicts and repo bloat.

**If you'd rather commit it** — so teammates and CI get the graph without rebuilding —
drop the `graphify-out/` line from `.gitignore` and set up the union merge driver, which
`graphify hook install` configures:

```bash
graphify hook install    # also registers the graph.json merge driver
```

Without that driver, two people rebuilding the graph produces an unmergeable
`graph.json` conflict every time.

---

## 8. Privacy & cost

- **Source code never leaves your machine.** tree-sitter parses it locally; there is no
  API call in the code path.
- **Docs, Markdown, and PDFs go to your configured AI backend.** Inside Claude Code
  that is your existing session — no separate API key needed.
- For headless/CI runs, graphify picks a backend from whichever key is set:
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`,
  `OLLAMA_BASE_URL`, or AWS credentials for Bedrock. `--code-only` skips this entirely.
- No telemetry. Query logging is off by default.

Since this repo's `.env` is authoritative for both halves of the stack and holds real
bot tokens and API keys, note that `.env` is gitignored and therefore already invisible
to graphify. Keep it that way.

---

## Quick reference

```bash
uv tool install graphifyy          # install CLI
graphify install                   # register /graphify skill
/graphify .                        # first build (assistant-driven, indexes docs too)
/graphify . --update               # incremental rebuild

graphify extract . --code-only     # or: build offline, no LLM, ~14s
graphify cluster-only . --no-label #      …then subsystems + report + graph.html

graphify path "A" "B"              # trace A → B  (read this one directly)
graphify explain "X"               # X and its neighbours, with file:line
graphify affected "X"              # blast radius of changing X
graphify god-nodes                 # architectural hubs
graphify query "..."               # subgraph as LLM context, not a prose answer
graphify hook install              # rebuild on every commit
```
