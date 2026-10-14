# Summary error and retry prototype (throwaway)

Question: when Generate fails and the Summary tab stays on the pending "Paste AI
Response" panel, how should it show the error and offer Retry?

## Verdict (2026-10-14): variant F

Chosen by the user over A, B, C, D and E (all in this branch's history). F is:

- the finished report's layout: "Analysis Report" header with a Failed chip and a
  Copy prompt icon, the Scope and provenance lines, the latest error in red with
  earlier attempts folded, then "Try again" and "Use another AI" cards (side by side
  on desktop, stacked full-width on phones), the saved prompt folded;
- Key and Model chips on the retry, like the Action tab's "Run with" bar, the model
  list coming from the chosen Key; neither changes the account's selection;
- attempts stored in their own table, not the LLM logs, so pruning logs never erases
  a Summary's history; each attempt keeps outcome, error kind, error, model, Key,
  partial text, automatic flag and time;
- `failed` as a state of its own, shown in History as a red "Failed ×n" card;
- the retry running on the server, watched over SSE, surviving a reload or closed tab;
- one automatic retry for transient failures (overloaded, 5xx, timeout, dropped
  stream), with a countdown honouring Retry-After and a Cancel;
- every draft from a cut stream listed, each with Keep, Dismiss and, once dismissed,
  Restore;
- the saved prompt's size checked against the chosen model's context window;
- a "Summary not started" page for a Generate that fails before any Summary is
  saved (the 413 token-limit refusal), with Change selection leading when no model
  can fit.

What the real build must decide or build, none of it answered here:

1. `failed` as a real `status` value on `tg_summaries`, not derived from attempts.
2. `tg_summary_attempts`: user-owned, cascading from `tg_summaries`, on neither
   retention inventory, with a migration and the tenancy seam's classification.
3. The retry as a worker job (lane, quota ladder, `LISTEN`/`NOTIFY` progress, SSE),
   streaming the stored prompt into the same pending Summary; the worker, not the
   page, owns the automatic retry.
4. `context_length` on `POST /ai/models` instead of OpenRouter's public list.
5. Start failures have no Summary id; whether they persist at all.

## Run it

    cd backend && PROTO_API_BASE=<api-base> PROTO_DB=<scratch path>.sqlite3 \
      PROTO_PORT=8021 uv run python scripts/proto_summary_attempts_api.py
    cd frontend && PLAYWRIGHT_API_URL=<api-base> bun run dev --port 5193

Vite proxies `/proto` to the attempts API (`PROTO_API_PORT`, default 8021). Log in,
open a pending Summary and add `&variant=F`; `0` is today's panel, unchanged. The
floating bar cycles them. "Next retry" picks how a stubbed run ends (quota,
overloaded, stream cut, succeeds), "Log attempt" records one as if a Generate had
just ended that way, and "Fake start failure" shows the not-started page. Runs and
Keep draft are stubbed: they stream made-up text and record attempts; nothing is
sent to a provider. Paste response is real, as in the app today.
