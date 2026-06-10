# Ideas Log

A lightweight backlog for features, refactors, and experiments you want to tackle **later** — often in a focused session with Cursor.

## Files

| File | Purpose |
|------|---------|
| [IDEAS-LOG.md](./IDEAS-LOG.md) | Master list: status, priority, one-line summary |
| [_template.md](./_template.md) | Copy when an idea needs more than a few lines |
| `ideas/` | Optional detail files (`IDEA-NNN-short-slug.md`) linked from the log |

## Workflow

1. **Capture** — Add a row to the backlog table in [IDEAS-LOG.md](./IDEAS-LOG.md). Use the next `IDEA-NNN` id.
2. **Expand (optional)** — Copy [_template.md](./_template.md) into `ideas/IDEA-NNN-short-slug.md` and link it from the table.
3. **Start work** — Move the row to **In progress** and tell the agent: *"Work on IDEA-NNN from the ideas log."*
4. **Finish** — Move to **Done** with the PR/commit link, or to **Parked** with a short reason.

## Status values

| Status | Meaning |
|--------|---------|
| `backlog` | Not started; default for new ideas |
| `in-progress` | Actively being worked on |
| `done` | Shipped or resolved |
| `parked` | Deprioritized, blocked, or superseded |

## Tips for AI sessions

- Reference the idea id (`IDEA-003`) so context survives across chats.
- Put constraints, non-goals, and links in the detail file — keep the table row scannable.
- One idea per session when possible; split large ideas into multiple ids before starting.
