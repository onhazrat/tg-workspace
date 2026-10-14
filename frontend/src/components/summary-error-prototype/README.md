# Summary error and retry prototype (throwaway)

Question: when Generate fails and the Summary tab stays on the pending "Paste AI
Response" panel, how should it show the error and offer Retry?

Run: `cd frontend && PLAYWRIGHT_API_URL=<api-base> bun run dev --port 5193`, log in,
open a pending Summary, and add `&variant=D` to the URL. The floating bar
and the left/right keys cycle variants.

- `0` today's panel, unchanged (the reference).
- `D` the finished report's layout (header with Failed chip and Copy prompt icon,
  Scope and provenance lines, the error with earlier attempts folded, Try again and
  Use another AI cards) over attempts kept in their own storage, plus a `failed` state,
  kept drafts and one automatic retry. See below.

A (banner over today's panel), B (one Try again card, Paste as a header icon), C (D's
layout with in-memory attempts) and E (D with the paste in the page instead of a
dialog) were dropped after review; they are in this branch's history.

D reuses the report's patterns on purpose: `summaryScopeLine`, the icon-action header,
chevron folds like its sections, cards like Publish to Telegram, and the Scope line
with "Use this Scope" at the bottom.

Every Retry has Key and Model chips like the Action tab's "Run with" bar. The model
list is the chosen Key's own catalogue (`useAiModels(keyId)` and a `keyId` prop on
`ModelCombo`, both prototype additions), so another Key's models are reachable.
Switching Key restores the model last run on it. Both start at the last attempt's
Key and model and never change the Action tab's selection or a Key's remembered model.
Each failure is kept with its attempt number, model, Key and time.

Retry is stubbed: no request, no spend, no write. "Next retry" in the bar picks the
stub's outcome and "Log attempt" records one. A real failed Generate records its real
reason, model, Key and any partial text.

Not answered here, and the real build has to: making `failed` a real status value,
and streaming the stored prompt back into the same pending Summary on Retry.

## Start failures (no pending Summary)

A Generate can fail before its pending Summary is kept: the server refuses to build
the prompt (413, too many posts or tokens), a sync fails, the network drops. The
provisional row is deleted, so the pending panel never exists and today only a toast
says why. Variant D shows it on the empty Summary tab instead ("Summary not
started"), with Change selection as the primary way out. "Fake start failure" in
the bar triggers it; a real one from Generate in this tab is recorded too. Its
"Generate again" is stubbed.

## Variant D: stored attempts, failed state, drafts, auto-retry

Needs the prototype attempts API as well as the dev server:

    cd backend && PROTO_API_BASE=<api-base> PROTO_DB=<scratch path>.sqlite3 \
      PROTO_PORT=8021 uv run python scripts/proto_summary_attempts_api.py

Vite proxies `/proto` to it (`PROTO_API_PORT`, default 8021).

- **Attempts are their own entity**, not LLM logs: logs are pruned for space and that
  must not erase a Summary's history. One row per Generate or Retry: outcome
  (failed, succeeded, kept_draft), error kind, error, model, Key, partial text, auto
  flag, time. Here a local SQLite file, so nothing is written to the deployment; the
  real build is a user-owned Postgres table cascading from `tg_summaries` and on
  neither retention inventory. Real failed Generates are recorded too (AIContext).
- **Failed is its own state.** A pending Summary with no attempts is a Copy Prompt item
  and keeps today's panel. One whose latest attempt failed gets the failure page, and
  History shows a red "Failed ×n" card instead of "Awaiting response". The real build
  should make this a `status` value rather than derive it.
- **Drafts.** Text a dying stream produced is stored on the attempt (AIContext now
  captures it). Every failed attempt's draft is listed, newest first, each with Keep
  this draft, Show all and Dismiss. Dismiss sets `draft_dismissed_at` on the attempt:
  the text stays stored, it is only no longer offered. Keeping one records a
  `kept_draft` attempt carrying that text.
- **One automatic retry** for a transient failure (overloaded, 5xx, timeout, dropped
  stream): a countdown honouring the provider's Retry-After, else 10 s, with Cancel.
  Never for an automatic attempt, never for a failure older than two minutes found on
  reload, never for quota, auth, model or limit errors.

The bar's "Next retry" picks what the stub does (quota, overloaded, stream cut,
succeeds) and "Log attempt" records one as if a Generate had just ended that way.
Retry and Keep draft only record attempts; nothing is sent to a provider.
