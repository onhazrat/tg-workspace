# #58 📝 H3: write down the service-boundary rule

**State:** merged 2026-07-31 · **Branch:** `h3-service-boundary-rule` into `main` · **Diff:** +38 / -8 across 3 files · **Opened:** 2026-07-31

---

First execution unit from `docs/architecture-simplification-plan.md`. **Docs and CLAUDE.md only — no code touched.**

## Why

`app/services/` has 44 modules and no written rule for when code becomes its own module. Without one, every new feature re-litigates where its code goes — and a reader cannot tell a principled split from an accidental one. That is the definition of architecture entropy, and it is what would re-create the sprawl after workstreams C and H.

## What

A five-kind taxonomy in CLAUDE.md. Every service module is exactly one of:

1. **Aggregate** — owns one table, sole writer of it
2. **Read model** — reads across tables, takes a `Session`, never commits
3. **Integration** — owns one external boundary
4. **Pure transform** — no `Session`, no network
5. **Orchestrator** — owns one workflow, coordinates the other four

Plus the anti-rule: **never split a module because it got long.**

## What the analysis changed

Classifying all 44 modules against the rule **corrected my own audit**. 41 of 44 fit cleanly — the `discover_*` and `post_*` clusters I had flagged as arbitrary are principled: `discover_probes`/`discover_reports`/`discover_ignored` each own a distinct table, `discover.py` never commits, and the `post_*` parsers take no `Session` at all.

**The defect was the absence of a rule, not the module count.** Audit §E7 is corrected in place rather than left to misdirect the work.

Three genuine exceptions are *recorded, not fixed*, to keep this docs-only:

| Exception | Status |
|---|---|
| `async_db.py` — 12-line infra utility misfiled under `services/` | belongs in `core/` |
| `followed_channels.py` writes `Channel` alongside `channels.py` | deliberate — shared creation path for Discover + auto-follow |
| `AppSetting` has **three** writers incl. `routes/data.py` directly | also violates thin-routes — fold into workstream C |

## Verification

No code touched. Before starting, I established an attributable baseline on unmodified `main`: **backend 733 passed / 1 skipped**, **frontend 679 pass / 0 fail**. Pre-commit hooks pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
