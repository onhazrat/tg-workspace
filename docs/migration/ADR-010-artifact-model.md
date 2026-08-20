# ADR-010: One artifact model, four kinds, one unified read model

**Status**: accepted (2026-08-20)

The app produces four durable outputs a person asks for — Summary, Chat, Tag
run, Discovery report — but only three had tables and only two reached the
History tab. A Chat was stored as a `tg_summaries` row whose `text` began with
the literal string `"Chat: "`. We are giving Chats their own aggregate and
adding a single `GET /api/v1/data/artifacts` read model that unions all four, so
History lists every artifact in one time-ordered page.

## Context

`Summary`, `TagRun` and `DiscoverReport` were each modelled as an artifact with
a frozen scope snapshot. Chat was not: `ChatContext` either patched the
currently-selected summary's `chatMessages` or invented a summary titled
`Chat: <first 50 chars>`. Three consequences followed, all of them live bugs
rather than untidiness:

- The *kind* of an artifact was encoded in a prefix of its body text. The
  history list, the type filter and the restore path each re-derived "is this a
  chat?" with `str.startswith("Chat: ")`. A summary legitimately beginning with
  those six characters was a chat.
- A chat started while a summary was open **mutated that summary** instead of
  becoming its own row, so it never appeared in History as a distinct thing.
- Tag runs were persisted and had a working list endpoint, but History never
  read it.

## Decision

**Chats become a first-class aggregate.** `tg_chat_sessions` plus
`tg_chat_session_payloads`, mirroring the `Summary` / `SummaryPayload` split.
The transcript lives in the payload table so listing never touches it; `title`
and `message_count` are derived columns maintained on write.

**A Chat depends on its Scope, not on a Summary.** We deliberately did *not*
add `source_summary_id`. The code decided this for us: chat mode `"summary"`
never read the summary — `ChatContext` builds its prompt from
`getPromptPostsInput()`, the selected channels and the date range, exactly as a
summary does. The only thing ever linking the two was `currentSummaryId` being
ambient UI state. Deleting a Summary therefore does nothing to Chats.

**One read model over four tables.** `GET /data/artifacts` is a `UNION ALL`
projecting a common shape with a `kind` discriminator, ordered
`(timestamp DESC, id)`, filterable by kind, paginated. The alternative — merging
four list queries in the browser — was rejected because "load more" is
undefined across four independently-capped lists and search only reaches
whichever kinds support it.

**The union selects named columns, never entities.** `TagRun.prompt_text`,
`TagRun.response_text`, `TagRun.suggestions` and `DiscoverReport.candidates`
are corpus-sized and live in the same table as their metadata, so
`select(TagRun)` detoasts every historical prompt. Both existing list endpoints
already had this defect — `list_tag_runs` projected to light *in Python*, and
`list_reports` detoasted the whole candidate blob to compute `len()`. Both are
fixed here, and `DiscoverReport` gains a derived `candidate_count`.

## Consequences

**The backfill is a script, and `prestart.sh` runs it on deploy.**

It started as an operator-run tool on the argument that nobody should delete
user artifacts unattended. That argument was weaker than it looked, and the
deciding fact is the other way round: until the backfill runs, every existing
chat is still a `tg_summaries` row that History renders as a summary with an
empty body — so a deploy that migrates the schema and *not* the data leaves the
app visibly broken. A deploy is the only moment the two are guaranteed to be in
step.

Three properties make it safe to automate, and they are what the guard in
`tests/deployment/test_worker_count.py` pins:

- **Idempotent** — chat session ids are derived from the summary id, and an
  already-moved row is counted and skipped.
- **Resumable** — keyset paging means a partial run continues exactly where it
  stopped, rather than restarting or silently stopping early.
- **Reversible** — the revision's downgrade merges transcripts back into
  `tg_summary_payloads.chat_messages` losslessly.

It is deliberately *not* wrapped in `|| true`: a half-migrated database that
boots anyway is worse than a deploy that stops and says why. `--dry-run` remains
for running it by hand against a database you want to inspect first.

The Alembic revision itself stays DDL only, so the schema change and the data
move remain separately reversible.

**`chatMessages` stays in `summaries.PAYLOAD_COLUMNS`.** Removing it once chats
have their own table would route an unrecognised `chatMessages` key on
`PUT /data/summaries/{id}` straight into `extra`, silently reinstating the 26 MB
regression that `z8a9b0c1d2e3` fixed. The live app simply stops writing it.

**History search no longer matches summary prompt bodies.** Reaching them needs
an `EXISTS` against a payload table, and never opening a payload table is the
whole contract of `/artifacts`. `/data/summaries?search=` keeps the capability
if we find we want it back.

**Artifact list items are a discriminated union, not one optional-field model.**
Following `schemas/discover.py` and `schemas/tag_runs.py`: a declared optional
field serialises as an explicit `null` where the key is absent, which would put
four dead keys on every summary row and give TypeScript a type that narrowing by
`kind` tells nothing.

**`/data/discover/reports/latest` is deleted.** Its only caller was Discover's
auto-open-latest behaviour, which History replaces.
