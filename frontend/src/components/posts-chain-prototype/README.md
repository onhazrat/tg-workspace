# Posts reply chain prototype (throwaway)

Answered: how a reader follows a Reply chain on the Posts tab, by keyboard,
mouse and phone. **Verdict: A3**, decided 2026-11-02. The spec and tickets are
`.scratch/posts-reply-chain/` (RCH) on main; they, not this code, are the
source. Albums turned out to need their own effort: `.scratch/album-posts/`
(ALB, ADR-046).

Variants on the Posts tab, `?variant=`, switched by the bar at the bottom or
Alt+← / Alt+→:

| Key | What it does |
|---|---|
| 0 | Main exactly |
| A | `[` moves the feed's Highlight to a parent the feed shows, else opens the side panel; `]` steps back |
| A2 | `[` always opens the panel, one level per press; `{` to the top, `}` back to the start |
| A3 | `[` opens the whole chain in the panel; `j k gg G` move inside it; `]` closes (the winner) |

Variants A to A3 also carry the held new-Posts pill with `.` and the
skeleton in the loading layout's shape (RCH-01). Variants B (a "Thread"
button) and C (the chain inline in the card) were tried and dropped.

## Running it

From `frontend/`, against any deployment's API (no prototype backend):

```bash
PLAYWRIGHT_API_URL=<api base> bun run dev --host 127.0.0.1 --port <port>
```

Then open `/?tab=posts&variant=A3`. `vite.config.ts` allows `*.ts.net`
hosts for sharing over `tailscale serve`.
