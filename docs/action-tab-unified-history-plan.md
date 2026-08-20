# Action tab, unified History, and workspace fullscreen

## Context

Three requests, one underlying shape: the summarizer's workspace has grown to
eight tabs where each AI feature owns both its create form and its result view,
and History only knows about two of the four artifact kinds the app produces.

1. **No fullscreen.** The workspace is capped at `max-w-app` (80rem) with `p-8`
   padding, a title block and a stats strip above it. On a wide monitor the
   Channels grid and Posts feed waste most of the screen. Nothing today
   resembles a focus or fullscreen mode.
2. **History is incomplete.** It lists summaries, plus discovery reports in a
   separate collapsible section. Tag runs are persisted in `tg_tag_runs` and
   have a working list endpoint, but only ever appear inside the Tag tab. Chat
   sessions have no table at all — a chat is smuggled into `tg_summaries` as a
   row titled `Chat: …`, which means a chat started from an existing summary
   silently *mutates that summary* and never becomes its own history entry.
3. **No single entry point for "make something".** Creating a summary, a tag
   run, a discovery report or a chat means knowing which of four tabs to visit
   first. The intended end state is Channels / Posts / Action / History /
   Settings, with the four feature tabs hidden and Action as the one place you
   start work.

Outcome: an `Action` tab that owns every create form, a History that lists all
four artifact kinds in one time-ordered list, chats promoted to real artifacts,
and a fullscreen toggle that works on any tab. Tab hiding ships as a setting,
defaulted off, so the switch is yours to flip when Action has proven itself.

## Status: implemented

All five units shipped on `feat/action-tab-unified-history` (7 commits, 75 files,
+6,370/−1,741). Deviations from this plan, and why:

| Planned | Shipped | Why |
|---|---|---|
| Open `TagRunResponse`/`DiscoverReportResponse` for `isStarred` | **Declared** the keys; models stay closed | `types.ts` derives `TagRun` from the generated model, and `Omit<>` over an index signature collapses every field to `unknown`. Caught by `client-split.conform.ts`. |
| `text_excerpt` derived column on `Summary` | `left(text, 200)` in the union | The read cost is unchanged either way and `text` is already shipped in full by `/data/summaries`; a migration bought nothing. |
| History rows render per-kind cards | One card for all four kinds | History answers "what did I make, and when". Per-kind detail belongs on the tab that renders the artifact. |
| — | `PUT /discover/reports/{id}/flags` | Reports had no write endpoint at all, so starring them was impossible. |
| — | `latest_report` service + tests deleted | Deleting the route left the helper with no caller. |

Bugs found and fixed on the way, none of which this plan predicted:

1. `chat_messages IS NOT NULL` matches every summary with *any* payload —
   SQLAlchemy's JSON type stores Python `None` as a JSON `null`, not SQL NULL.
   The backfill would have created an empty chat session per summary.
2. `cast("[]", JSONB)` binds a Python string, comparing against the JSON string
   `"[]"` rather than the empty array.
3. Postgres does not short-circuit `AND`, so `jsonb_array_length` ran on rows the
   type check had already excluded and errored on scalars.
4. `TagRunListItemResponse.post_count` was `int` while the column is nullable —
   `GET /data/tag-runs` was a 500 for any run created without one.
5. `tg_tag_runs` was missing from the test truncation list, exactly as predicted.

## The code review found twelve defects the guards did not

Worth recording, because the split is informative. **The backend SQL work came
through clean** — the union, the migration, the payload-cost guards all held
under review. Everything found was on the *wiring* side, where nothing was
asserting anything:

| Finding | Why no guard caught it |
|---|---|
| `?summary=`/`?chatSession=`/`?tagRun=` written but never read | Nothing asserts that a param has a consumer. Deleting `applyHistorySummarySelection` left a hole the type system cannot see. |
| "Clear Conversation" overwrote the saved transcript | `currentSummaryId` was reset, `currentChatSessionId` was not — two ids where there had been one, and only one call site updated. |
| `updatedAt` shadowed its own column | `to_snake("updatedAt")` is `updated_at`; the column is `updated_at_ms`. The key looked unknown, landed in `extra`, and `extra` is spread last. |
| Backfill `--dry-run` under-reported past `batch` | Paging by "rows that still match" terminates immediately when the writes are rolled back. |
| Clearing a note did nothing | `JSON.stringify` drops `undefined`, so `note ?? undefined` sent `{}`. |
| Auto-regenerate/auto-publish dropped | Rewriting the card lost two controls with no compile error, making a shipped feature unreachable. |
| Starred filter chain-fetched the whole history | Client-side filtering interacts badly with infinite scroll — the reasoning in the original comment was simply wrong. |

The lesson matches this repo's own thesis: the parts with guards survived a
rewrite; the parts held together by prose and attention did not. Three of these
were breaking shipped behaviour, and one of them silently destroyed user data.

One guard needed a second pass: removing the union's `id` tiebreak did **not**
turn the ordering test red, because each leg is already sorted internally and a
single-kind page comes back ordered by accident. It now collides timestamps
*across* legs and asserts the emitted `ORDER BY` directly.

---

## Decisions taken

| Question | Decision |
|---|---|
| Fullscreen semantics | Native Fullscreen API **and** in-page focus mode from one button |
| Action tab in pass 1 | Hosts the real create forms, not a launcher |
| History layout | One unified list with a `kind` filter |
| Chat storage | New `tg_chat_sessions` table; chats become first-class |
| Chat backfill | **Move**, not copy — no artifact appears twice |
| Old tabs | Create controls **move out**; those tabs become results-only |
| Tab hiding | Ships now as `compactWorkspaceTabs`, default **off** |
| Artifact merge | New backend `GET /api/v1/data/artifacts` read model |

Sharpened in a follow-up grilling round (Q1-Q23), recorded in `CONTEXT.md` and
`docs/migration/ADR-010-artifact-model.md`:

| Question | Decision |
|---|---|
| Vocabulary | Code nouns are canonical: `summary \| chat \| tag \| discovery`; labels say "Tag run", "Discovery" |
| Pending artifacts | Stay in History; `status` on the summary and tag legs **only** |
| Chat ↔ Summary | No relationship at all — **`source_summary_id` is dropped** |
| Starring | All four kinds; `TagRun` and `DiscoverReport` gain an `extra` bag |
| Search | `/artifacts` does not reach prompt bodies; narrowing accepted |
| Pagination | `useInfiniteQuery` over the existing observer |
| User scoping | `WHERE user_id = current OR user_id IS NULL` from day one |
| Hidden active tab | Rendered as a transient nav entry, marked current |
| Results-only tabs | Empty state pointing at Action — **including Discover** |
| Per-kind list endpoints | All kept; `/discover/reports/latest` **deleted** |
| Chat modes | `"full_scope"` / `"semantic"`, labels "Full scope" / "Semantic" |
| `LLMLog.log_type` | Renamed with a migration: `chat_full_scope`, `chat_semantic` |
| Deep search UI | Deferred, deliberately — not a silent gap |

---

## Unit 0 — Collapse the tab-id duplication (do this first)

`TabType` is declared by hand in `frontend/src/types.ts:469` and still carries
three dead members (`db`, `bots`, `logs` — grep confirms zero call sites).
`VALID_TABS` is then duplicated in `frontend/src/routes/_tg/summarizer.tsx:9`
and `frontend/src/hooks/useSummarizerTab.ts:5`. Adding `action` to only one copy
makes the tab silently fall back to `summary`, which is exactly the kind of
failure that wastes an afternoon.

Derive all three from the one list in `frontend/src/constants.ts`:

```ts
// constants.ts
export type TabType = (typeof WORKSPACE_TABS)[number]["id"]
export const VALID_TABS: readonly TabType[] = WORKSPACE_TABS.map((t) => t.id)
```

Re-export `TabType` from `types.ts` so the ~10 existing importers keep working.
Both `VALID_TABS` literals get deleted. After this, adding a tab is a one-line
change to `WORKSPACE_TABS`.

---

## Unit 1 — Fullscreen / focus mode

**New:** `frontend/src/hooks/useWorkspaceFullscreen.ts`

One hook, one button, two effects that must stay in step:

- **Native.** `document.documentElement.requestFullscreen()` on enter,
  `document.exitFullscreen()` on exit. Wrapped in a capability check —
  `requestFullscreen` rejects in iframes without `allow="fullscreen"` and the
  promise rejection must not leave focus mode stranded.
- **Focus mode.** A boolean that `App.tsx` uses to drop the chrome: the `<h1>`
  title block and its icon cluster, the Last Sync / Active Channels / Posts in
  Scope strip, `app-shell`'s `max-w-app`, and `p-4 md:p-8` → `p-0`. The tab nav
  stays — you must be able to switch tabs while fullscreen, which is the point
  of "inside whichever tab that I am".

The two can desynchronise, so the hook subscribes to `fullscreenchange` and
clears focus mode when the browser drops out of fullscreen (Esc, F11, window
manager). Without that listener, Esc leaves you in a chromeless page with no
visible way back.

**Persistence.** Focus mode is declared in
`frontend/src/lib/settings/schema.ts` as
`workspaceFocusMode: booleanSetting("workspaceFocusMode", false)` — local only,
no `section`, alongside the `discover*` prefs. Native fullscreen is *not*
persisted and cannot be: browsers require a user gesture, so a reload restores
focus mode without native fullscreen. That asymmetry is deliberate; say so in
the hook's docstring rather than trying to defeat it.

**Button.** A fifth icon-only control in the header cluster
(`App.tsx:375-437`), `Maximize2` / `Minimize2` from lucide-react, with
`aria-label` and a tooltip mirroring the existing four. In focus mode the header
is gone, so a compact exit control renders at the right end of the tab nav.

**Guard.** `frontend/src/lib/a11y-invariants.test.ts` currently asserts
`aria-label` count `>= HEADER_ICON_BUTTONS.length`, so a fifth unlabelled button
would pass. Add `"Maximize2"` to `HEADER_ICON_BUTTONS` (line 23) and add a case
asserting the fullscreen control is reachable in *both* states — the exit
affordance is the part that can go missing.

---

## Unit 2 — Chat sessions become first-class

Chats are the only artifact with no table of its own. Today
`frontend/src/contexts/ChatContext.tsx:296-331` either patches the current
summary's `chatMessages` or invents a `Chat: …` summary. Both paths go away.

**Backend.** New `ChatSession` / `ChatSessionPayload` models in
`backend/app/models_tg.py`, mirroring `Summary` / `SummaryPayload` exactly —
including the list-vs-detail split, since a transcript is corpus-sized and the
`SummaryPayload` docstring (`models_tg.py:161-200`) explains at length why that
must be a companion *table*, not a deferred column. New aggregate service
`backend/app/services/chat_sessions.py` owning both tables. Routes under
`/api/v1/data/chat-sessions`.

**Migration.** Schema in Alembic; the data move in a separate
`backend/scripts/` backfill with `--dry-run` first, per the repo convention.
The move, precisely:

- summary where `text` starts with `"Chat: "` → create chat session, **delete**
  the `tg_summaries` and `tg_summary_payloads` rows.
- summary with both a real summary and `chat_messages` → keep the summary,
  **clear** `chat_messages` from its payload, create a standalone chat session.

**There is no link between the two.** `source_summary_id` was in an earlier
draft and is gone: `ChatContext.tsx:177-240` proves chat mode `"summary"` never
reads the summary — it builds its prompt from `getPromptPostsInput()`, the
selected channels and the date range, exactly as a summary does. The only thing
that ever tied a chat to a summary was `currentSummaryId` being ambient UI
state. A chat depends on its scope; that is the whole relationship.

**Chat modes are renamed in the same unit.** `chatMode` is pure React state —
never persisted, never sent to the server — so `"summary" | "history"` becomes
`"full_scope" | "semantic"` for the cost of a type, two labels and the new
`ChatSession.mode` column adopting the new values at birth. The old names were
actively wrong: `"summary"` reads no summary and `"history"` has nothing to do
with the History tab. `LLMLog.log_type` follows with a real migration —
`"chat"` → `"chat_full_scope"`, `"rag_chat"` → `"chat_semantic"` (every
historical `"chat"` row was written in full-scope mode, so the mapping is
lossless both ways). `LlmLogsTab.tsx:59` branches on `log.type === "chat"` and
must move in the same commit or the logs viewer stops recognising chat rows.

**Frontend.** `ChatContext` writes chat sessions, not summaries.
`currentSummaryId` splits into `currentSummaryId` (what the chat is *about*) and
`currentChatSessionId` (what is being written) in `UIContext`. This is the one
place the units genuinely interlock — do it before Unit 3, because the unified
artifacts query reads `tg_chat_sessions`.

**One live bug found on the way.** `backend/scripts/tg_test_pollution.py`'s
`TG_TABLES` tuple is missing `tg_tag_runs`, so tag runs are never truncated
between tests. Harmless today because nothing cross-reads them — and not
harmless the moment `/data/artifacts` does, when rows leaked by one test start
appearing in another test's page. Fix it with the two new table names.

*(Full backend design — model fields, derived columns, UNION shape, schema
placement, service kinds, migration/backfill/downgrade, guards — in the
appendix below.)*

---

## Unit 3 — Unified History

**Backend.** `GET /api/v1/data/artifacts` — a read model (never commits) doing a
4-way `UNION ALL` over `tg_summaries`, `tg_chat_sessions`, `tg_tag_runs`,
`tg_discover_reports`, projecting `kind` + a common light shape, ordered
`timestamp DESC, id`, with `kind` / `search` / `limit` / `offset`.

The one thing that must not slip: **the union selects named columns, never
whole entities.** `TagRun.prompt_text`, `TagRun.response_text`,
`TagRun.suggestions` and `DiscoverReport.candidates` are corpus-sized and live
in the *same table* as their metadata, so `select(TagRun)` detoasts every
historical prompt — the identical defect that made `/data/summaries` ship 26 MB
and `/data/logs/sync` 56 MB.

**Both existing list endpoints already have it.** Not hypothetically:

- `services/tag_runs.py:65` — `list_tag_runs` does `select(TagRun)` and calls
  `tag_run_to_camel_light` *in Python*. The light projection drops
  `promptText` / `responseText` / `suggestions` from the wire, so the endpoint
  looks fine, but every historical prompt corpus is still read off disk on
  every call.
- `services/discover_reports.py:163` — `list_reports` does
  `select(DiscoverReport)` and then `len(report.candidates)`. It detoasts the
  entire candidate blob of every report on the page **to compute a count**.

This is the third time the same defect has shown up in this codebase, and the
reason it survived here is that neither table has a payload-cost guard —
`CLAUDE.md`'s guard table covers summaries and logs only. Fix both in this pass
rather than building the union on top of them:

- Add a derived `candidate_count` column to `DiscoverReport`, maintained on
  write, so counting never opens `candidates` (the same trick as
  `Summary.chat_message_count`).
- Rewrite both list queries to select named columns.

Splitting these into companion tables would be the more thorough fix, and is
what the `SummaryPayload` docstring argues for. I'm not proposing it here: it
doubles the migration surface of an already large change, and column-level
projection plus a guard gets the measured win. Note it as follow-up.

**Three things the union carries that an earlier draft missed:**

- **`status`, on the summary and tag legs only.** `copySummaryPrompt` writes a
  summary with `status: "pending"`, and History renders those in amber with
  "Awaiting response" and a disabled regenerate button (`HistoryView.tsx:580`,
  `:748`). Without `status` the unified list would show a pending summary as a
  normal one with an empty body. Chats and discovery reports have no pending
  state, so they do not declare the field — a `status: null` on them is exactly
  the invented null the discriminated union exists to avoid.
- **`is_starred` for all four kinds.** `TagRun` and `DiscoverReport` each gain a
  nullable `extra` JSON bag (one column, no data migration) so `isStarred` and
  `note` work uniformly. History's starred-only filter would otherwise silently
  empty half the list, which is worse than either not having it or not having
  starring.
- **`WHERE user_id = <current> OR user_id IS NULL` on every leg.** Nothing
  scopes by user today, but multi-user is on the roadmap and this is a brand-new
  endpoint with no clients. Retrofitting four union legs later is the expensive
  version of the same work; the `IS NULL` clause keeps today's unowned rows
  visible.

**Frontend.** `frontend/src/components/HistoryView.tsx` (currently 37.8 KB)
becomes a thin shell over a paginated `useArtifactsQuery`, with a
`[All][Summary][Chat][Tag][Discovery]` segmented filter replacing today's
`all | summary | chat`. One row renderer per kind under
`frontend/src/components/history/`. Retire `DiscoverReportsHistory`'s separate
mount (`HistoryView.tsx:549`) and the Tag History panel in
`TagView.tsx:209-258`.

Pagination is `useInfiniteQuery` over the `IntersectionObserver` History
already has (`HistoryView.tsx:120-133`), which today scrolls a client-side slice
of a fully-loaded list. The stable `(timestamp DESC, id)` ordering is what makes
that safe across a union — without the `id` tiebreak, pages duplicate and skip.

Row click restores scope and opens the artifact, extending the existing
`applyHistorySummarySelection` (`frontend/src/lib/commands/history-selection.ts`)
into a per-kind dispatch. Discovery already deep-links via `?report=`; add
`?summary=`, `?tagRun=` and `?chatSession=` to `SummarizerSearch` in
`routes/_tg/summarizer.tsx` so every kind is linkable, following the
`useDiscoverReportParam` pattern.

The existing "loaded from history" scope banner (`App.tsx:282-312`) applies to
all four kinds now — each carries a frozen channel/date scope.

---

## Unit 4 — The Action tab

**New:** `frontend/src/components/ActionView.tsx` plus
`frontend/src/components/action/` for the cards.

Inserted at position 3 in `WORKSPACE_TABS` (after `posts`), icon `Zap`, and —
because Unit 0 landed — that single edit is enough for the route validator, the
tab type, the command palette entry (`lib/commands/navigate.ts` generates
"Go to Action" free) and the nav.

`App.tsx`'s ternary ladder gets an `activeTab === "action"` branch **before**
the `PostFeed` fall-through. Everything Action needs is already in scope: all
four create paths share `getPromptPostsInput()` / `getScopedPosts()` from
`hooks/usePromptPosts.ts` via `ScraperContext`, and Action renders inside
`TgProviders`, so no provider changes.

The four cards, and what moves:

| Card | Moves from | Cost |
|---|---|---|
| Summarize | `SummaryConfig` (`SummaryView.tsx:338`) | Trivial — the component is prop-less |
| Tag channels | `TagConfig` (`TagView.tsx:91`) + `PasteTagsModal` | One prop (`onPasteClick`); modal state moves with it |
| Discover channels | `DiscoverReportBar`'s generate half (`DiscoverView.tsx:319`, and the duplicate empty-state button at `:438`) | Extract `liveParams` + `handleGenerate` (`DiscoverView.tsx:113-172`) into `hooks/useDiscoverGenerate.ts` |
| Chat | No existing config component | New: mode toggle + model/language + "Start a chat", which seeds `ChatContext` and navigates to `?tab=chat` |

Each card shows the live scope it will act on (`useScopedPostCounts()`) and
navigates to the result view on submit — `AIContext.handleSummarize` already
calls `setActiveTab("summary")` (`AIContext.tsx:221`), which stops being a no-op
and becomes the intended hop.

**The four results-only tabs show an empty state, not the latest artifact.**
With no artifact selected, Summary / Tag / Discover render "Nothing selected —
start one from the Action tab" rather than auto-opening. This is a deliberate
regression for Discover, which today auto-opens the most recent report via
`useLatestDiscoverReportQuery`: that behaviour existed because Discover had no
History surface of its own, and once every artifact is one click away in History
it becomes a special case to remember rather than a rule. **Delete
`GET /data/discover/reports/latest` and its hook** — its only caller is gone,
and anything wanting the newest report can ask `?limit=1`.

**One judgment call worth stating.** Tag's *Apply suggestions* button stays with
the preview table in `TagView`, not on Action. Apply confirms what the preview
shows; separating the button from the thing it confirms would be a worse UI than
the inconsistency of leaving one control behind.

Chat is the awkward one: it has no create form because the composer *is* the
result view. Action gets a "Start a chat" entry that sets mode and an optional
seed prompt, then navigates. Moving the composer itself would break autoscroll
and focus handling for no gain.

---

## Unit 5 — `compactWorkspaceTabs`

`booleanSetting("compactWorkspaceTabs", false)` in
`frontend/src/lib/settings/schema.ts`, surfaced in
`frontend/src/lib/settings/catalog.ts` with `group: "appearance"`,
`source: "app"` and `control: { kind: "boolean", commandSlug:
"compact-workspace-tabs" }` — the same shape as the `showChannel*` entries,
which also earns it a command-palette toggle for free. When on, the nav in
`App.tsx:537` filters `WORKSPACE_TABS` to Channels / Posts / Action / History /
Settings.

**Filter the nav only — never the route validator.** A hidden tab must stay
reachable by URL, or every existing deep link, palette command and
`setActiveTab("summary")` call breaks the moment the setting is flipped. This is
why `VALID_TABS` (Unit 0) is derived from the unfiltered list.

**When the active tab is a hidden one** — you flipped the setting while on
`?tab=summary`, or clicked a summary in History — render it as a transient nav
entry marked `aria-current`, which disappears once you navigate away. Leaving it
out puts you somewhere the UI will not admit you are; redirecting to `?tab=action`
throws away the artifact you just clicked, which is the most common way you will
land on a hidden tab.

**Command-palette entries stay for every tab**, hidden or not
(`lib/commands/navigate.ts`). Hiding a tab declutters the nav; it does not
remove capability. Filtering the palette too would make a hidden tab reachable
only by typing a URL.

Default off keeps `frontend/tests/summarizer.spec.ts:489` green, since it
asserts every `WORKSPACE_TABS` entry is visible.

---

## Sequencing

Five PRs, each independently mergeable and squash-merged (GitHub signs the
`main` commit; branch commits need no signature):

1. **Unit 0** — tab-id consolidation. Pure refactor, no behaviour change.
2. **Unit 1** — fullscreen. Fully independent; ship it early for the quick win.
3. **Unit 2** — chat sessions table, migration, backfill script, frontend rewire.
4. **Unit 3** — `/data/artifacts` + unified History. Depends on 2.
5. **Units 4 + 5** — Action tab and the compact-tabs setting. Depends on 0.

---

## Guards to add

Per CLAUDE.md: assert the reason, not just the state, and **mutation-test every
guard** — a green suite proves nothing until you have watched it go red.

| New guard | Asserts |
|---|---|
| `backend/tests/services/test_artifacts_list_payload_cost.py` | The union opens neither payload table **and** selects no heavy column of `tg_tag_runs` / `tg_discover_reports` |
| `backend/tests/services/test_chat_session_payload_cost.py` | Listing chat sessions never opens `tg_chat_session_payloads`, **and** the detail call does |
| `backend/tests/services/test_tag_run_list_payload_cost.py` | `list_tag_runs` selects columns, not the entity |
| `backend/tests/services/test_report_list_payload_cost.py` | `list_reports` never reads `candidates`; the count comes from the derived column; the detail call *does* read it |
| `backend/tests/api/test_artifacts_projection.py` | Key set per `kind` — no invented `null`s (CLAUDE.md's rule on conditional keys) |
| `backend/tests/services/test_service_kinds.py` (edit) | New modules declare their kind; `chat_sessions.py` owns its payload table |
| `frontend/src/lib/a11y-invariants.test.ts` (edit) | Fullscreen button is named, in both states |
| `frontend/src/lib/architecture-invariants.test.ts` (edit) | `compactWorkspaceTabs` filters the nav but not `VALID_TABS` |
| `frontend/src/api/client-split.conform.ts` (edit) | `ArtifactListItemResponse` is closed; `TagRunResponse` and `DiscoverReportResponse` are **open**, each with its reason |
| `backend/tests/services/test_artifact_user_scoping.py` | Every leg filters on `user_id`; a row owned by another user never appears |

Two twin-module notes from CLAUDE.md apply here: `chat_sessions.py` and
`summaries.py` become a twin pair (same payload-split shape), so parametrise the
payload-cost guard over both rather than writing it twice.

Regenerate the TypeScript client after the backend lands:
`bash scripts/generate-client.sh` (runs with `ENVIRONMENT=production`).

The split falls differently for the two new endpoints, and that is fine —
ADR-006 is decided per call, not per family:

- **`/data/artifacts` → generated client.** `ArtifactListItemResponse` is a
  closed discriminated union over named columns. No `extra` bag, so the
  generated TypeScript is a real discriminated union and strictly better than a
  hand-written type.
- **`/data/chat-sessions` → hand-written client**, same side as summaries.
  `ChatSession` keeps an open `extra` bag because it inherits `Summary`'s
  genuine grab-bag of conditional UI flags — `isStarred`, `note`, `postSearch`,
  `semanticSearchQuery`, `semanticSearchRespectsTimeRange`,
  `semanticSearchRespectsChannels`, all of which today come and go on the
  chat-only summary rows (`ChatContext.tsx:324-327`). Declaring them as columns
  would serialise four-plus explicit `null`s per row; keeping them open means
  OpenAPI renders a top-level `[key: string]: unknown`, which is exactly why
  `Summary` is hand-written already (`frontend/src/types.ts:40-54` — rebasing
  the hand-written types on the generated ones produced **190 type errors** of
  that shape). `title` and `messageCount` are declared, so they stay typed.

`client-split.conform.ts` asserts the split in both directions and will fail the
build if a call lands on the wrong side. Adding `extra` bags to `TagRun` and
`DiscoverReport` makes their detail responses **open**, and neither is asserted
in that file today — which is precisely the gap it exists to close. Add
`IsOpen` assertions for both with a one-line reason, plus `IsClosed` for the
artifact list item. Two open models nothing watches is the
leftover-nobody-dares-touch failure `CLAUDE.md` warns about.

---

## Verification

```bash
# Backend
cd backend && uv run alembic upgrade head
cd backend && TEST_POSTGRES_DB=app_test_action uv run pytest tests/ -q
cd backend && bash scripts/lint.sh

# Backfill, dry run first — inspect the counts before committing
uv run python backend/scripts/backfill_chat_sessions.py --dry-run
uv run python backend/scripts/backfill_chat_sessions.py

# Frontend
bun run --filter tg-summarizer-frontend test:unit
cd frontend && bunx tsc -p tsconfig.build.json --noEmit
bun run lint
```

End-to-end, against a local stack (`docker compose up -d db prestart backend`,
`bun run dev` — and rebuild the backend image after route changes, or a stale
API fails e2e in ways that look like frontend bugs):

1. **Fullscreen** — click the button on Posts; confirm native fullscreen plus
   the chrome collapsing. Switch tabs while fullscreen. Press Esc; confirm the
   header returns. Reload; confirm focus mode persists without native
   fullscreen.
2. **Chat migration** — before backfill, note a chat-only summary and a
   summary-with-chat. After: the first is gone from `tg_summaries` and present
   in `tg_chat_sessions`; the second is still a summary, its transcript now a
   standalone chat session with no link back. Nothing appears twice in History,
   and deleting the summary leaves the chat untouched.
3. **Unified History** — all four kinds interleaved by time; each filter chip
   narrows correctly; search reaches tag-run prompts and summary prompts;
   clicking each kind restores scope and opens the right view. Check the
   response size in the browser Network tab, not the container — this project's
   bottleneck has moved off the backend before and every server-side number said
   it was fine.
4. **Action tab** — generate one of each artifact from Action; confirm each
   lands in History and that the old tabs now show results only.
5. **Compact tabs** — flip the setting; confirm the four tabs vanish from the
   nav and that `/summarizer?tab=summary` still loads the Summary view *and*
   appears as a transient nav entry while active. Confirm "Go to Summary" is
   still in the command palette.
6. **Pending artifacts** — copy a summary prompt without pasting a response;
   confirm the row still renders amber with "Awaiting response" in the unified
   list.
7. **Starring** — star a discovery report and a tag run; confirm the
   starred-only filter returns all four kinds.
8. **Chat modes** — run one chat in each mode; confirm the new labels, and that
   `tg_llm_logs.log_type` records `chat_full_scope` / `chat_semantic`.

```bash
cd frontend && PLAYWRIGHT_CHANNEL=chrome bunx playwright test --workers=1
```

`summarizer.spec.ts` must run serially and wants a small warm database — an
empty or hugely grown one fails unrelated tests. Expect no CI checks on the PR;
the test workflows are billing-blocked and disabled.

---

## Companion documents

- `CONTEXT.md` (repo root, new) — the glossary. Artifact and its four kinds,
  Scope, Pending, Full scope vs Semantic, and the workspace terms.
- `docs/migration/ADR-010-artifact-model.md` (new) — why chats became
  first-class, why there is no chat→summary link, and why the merge is a server
  union rather than a client merge.

---

## Appendix — backend design detail

### A. Two pre-existing defects this work sits on

Both are in tables the union must read, and both are the defect CLAUDE.md
already documents twice. Fix them in this PR — leaving them means the list
endpoints and the union disagree about what is cheap, which is how someone
later "simplifies" the union back into `select(TagRun)`.

- `services/tag_runs.py:71` — `list_tag_runs` does `select(TagRun)` and drops
  the heavy fields in Python. `prompt_text`, `response_text`, `suggestions`,
  `all_tags_snapshot` are detoasted server-side for the whole page. The
  projection being in Python is worse than in SQL, not better.
- `services/discover_reports.py:158` — `report_to_camel_light` computes
  `candidateCount` as `len(report.candidates)`, detoasting the entire candidate
  array of every row to ship an integer.

### B. New models (`backend/app/models_tg.py`)

Place `ChatSession` / `ChatSessionPayload` immediately after `SummaryPayload`
(line 199), so the reader meets the split and then the artifact that copies it.
Both docstrings must carry their own reasoning — CLAUDE.md is explicit that a
deliberate exception nothing explains becomes a leftover nobody dares touch.

```
ChatSession (tg_chat_sessions)
  id, user_id(indexed), title: Text, channels: JSON,
  start_date / end_date / timestamp: ms int,
  language, model, post_count,
  mode: str,                  # "full_scope" | "semantic"
  extra: JSON,                # open bag, same as Summary — see below
  message_count: int,         # derived, maintained on write
  updated_at

ChatSessionPayload (tg_chat_session_payloads)
  chat_session_id  pk
  user_id  indexed
  messages: JSON              # [{role, text, sources?}]
  updated_at
```

**Exactly two derived columns: `title` and `message_count`.** The test is what
the list actually renders. Today `HistoryView.tsx:589` renders
`channels.join(", ")` as the heading and `markdownPreview(s.text)` as the body —
and for a chat-only row `text` *is* `"Chat: "` plus the first 50 characters of
the first user message. Nothing else from a transcript reaches the screen except
the count (`HistoryView.tsx:163`). No `last_message_excerpt`: an unrendered
derived column is one more thing to keep in step for nothing.

`title` is where the `"Chat: "` prefix goes to die. That prefix encoded the
*kind* of an artifact in a prefix of its body text — the list, the filter and
the restore path all re-derived "is this a chat?" from `str.startswith`, and a
summary that legitimately began with those six characters was one. The kind is
now a discriminator; the remainder was always the title.

**No `source_summary_id`.** An earlier draft had one; the code killed it.
`ChatContext.tsx:177-240` shows that chat mode `"summary"` never reads a
summary — it assembles its prompt from `getPromptPostsInput()`, the selected
channels and the date range, exactly as a summary does. A chat depends on its
scope and nothing else, which makes `ChatSession` a structural sibling of
`Summary` rather than a child. If "chats about this summary" is ever wanted, it
is a link table added when something needs it, not a column guessed at now.

**`ChatSession` keeps the open `extra` bag.** It inherits `Summary`'s real
grab-bag of conditional flags (`isStarred`, `note`, `postSearch`,
`semanticSearchQuery`, `semanticSearchRespects*`), which come and go per row
today. Declaring them as columns would emit four-plus explicit `null`s per row.
The consequence — chat-session calls live in the hand-written frontend client,
same side as summaries — is stated in the client-split note above.

Plus three columns on existing tables:

- `DiscoverReport.candidate_count` — maintained on write; the union needs it and
  it fixes defect two.
- `TagRun.extra` and `DiscoverReport.extra` — nullable JSON bags so `isStarred`
  and `note` work on all four kinds. One column each, no data migration.

And one migration on `tg_llm_logs`: `log_type` `"chat"` → `"chat_full_scope"`,
`"rag_chat"` → `"chat_semantic"`. Two `UPDATE`s with an exact inverse for the
downgrade. Every historical `"chat"` row predates semantic mode, so the mapping
is faithful.

### C. Service modules

- `backend/app/services/chat_sessions.py` — **aggregate**, owning
  `tg_chat_sessions` *and* `tg_chat_session_payloads` (the `logs.py` /
  `tg_sync_log_payloads` precedent: the split is a storage detail the API never
  sees, so one module knows the row is really two). Public surface mirrors
  `summaries.py` one-for-one: `derive_chat_title`, `chat_session_to_camel`,
  `chat_session_to_camel_light`, `_search_clause`, `list_chat_sessions`,
  `get_chat_session`, `apply_chat_session_payload`,
  `refresh_chat_session_derived_columns`, `upsert_chat_session`,
  `delete_chat_session`.

  One deliberate divergence: `chat_session_to_camel` **always** emits `messages`
  (as `[]` when there is no payload row), where `summary_to_camel` omits absent
  heavy keys. Summaries had a wire format to preserve byte-for-byte; this one is
  new, and a transcript that is a missing key rather than an empty list would
  put `?? []` in every consumer.

- `backend/app/services/artifacts.py` — **read model**. Takes a `Session`, never
  commits (`test_read_models_never_commit` walks the AST for `.commit()` and
  covers it once it is in the inventory). Reference: `discover.py`,
  `runtime_config.py`.

`backend/tests/services/test_service_kinds.py` holds a flat `INVENTORY` dict.
Add `"chat_sessions.py": AGGREGATE` and `"artifacts.py": READ_MODEL`, both
alphabetical, neither in `EXCEPTIONS`.

### D. The union query

Four `sa_select()`s over **named columns**, combined with `union_all`, wrapped
in a subquery, ordered and paged outside.

```python
def _null(type_):
    """A typed NULL. Postgres infers `unknown` for a bare NULL in a UNION leg,
    which either fails to unify with the other legs or silently degrades the
    column to text."""
    return cast(null(), type_)

_LEGS = {"summary": _summary_leg, "chat": _chat_leg,
         "tag": _tag_leg, "discovery": _discovery_leg}

def list_artifacts(session, *, kind=None, search=None, limit=..., offset=0):
    kinds = (kind,) if kind else ARTIFACT_KINDS
    legs = []
    for k in kinds:
        leg = _LEGS[k]()
        if term:
            leg = leg.where(_SEARCH[k](term))
        # Each leg can contribute at most offset+limit rows to the final page,
        # so bounding it here is exact, not approximate.
        legs.append(leg.order_by(_TS[k].desc(), _ID[k]).limit(offset + limit))
    u = union_all(*legs).subquery("artifact")
    stmt = select(u).order_by(u.c.timestamp.desc(), u.c.id).offset(offset).limit(limit)
    return [_row_to_camel(r) for r in session.execute(stmt).mappings().all()]
```

Four things that are not stylistic:

- **`UNION ALL`, never `UNION`.** `channels` is a PostgreSQL `json` column and
  `json` has no equality operator, so a de-duplicating `UNION` fails outright
  with `could not identify an equality operator for type json`. It is also
  semantically right — two artifacts never dedupe.
- **`kind` filters by not building the leg**, not by `WHERE kind = …` on the
  outside. `?kind=chat` must not put `tg_tag_runs` in the plan at all.
- **`session.execute(...).mappings()`, not `session.exec(...)`.** SQLModel's
  `exec` is typed for entity/tuple selects; a union subquery goes through plain
  `execute`, as `logs.py:455` and `stats.py:89` already do.
- **Per-leg `LIMIT offset + limit`** plus four `(timestamp DESC, id)` indexes
  turns four sorts into four index scans feeding a MergeAppend.

Per-kind mapping. There is no title column on any of the four, so `title` is a
new field defined as "the one line that distinguishes this artifact from its
siblings", never the whole body:

| | `title` | `timestamp` | `post_count` | extra field |
|---|---|---|---|---|
| summary | `left(text, 200)` | `timestamp` | `post_count` | `status` |
| chat | `title` column | `timestamp` | `post_count` | `messageCount`, `mode` |
| tag | `'Tags · ' \|\| mode` | `created_at` | `post_count` | `status`, `mode` |
| discovery | `coalesce(keyword, 'Discover')` | `timestamp` | `posts_in_scope` | `candidateCount` |

`title` is non-null in every leg — a nullable one pushes `?? ""` into every
consumer.

`left(text, 200)` bounds the **wire** cost, not the read cost: the detoast
happens server-side either way (CLAUDE.md's 2.86 s vs 2.69 s measurement). That
is acceptable here only because `/data/summaries` already ships `text` in full
today, so reading it is not a new cost — the union just must not multiply it
across four kinds on the wire. Do not reach for a derived excerpt column; it
buys nothing that is not already being paid.

**Timestamps need no conversion.** All four are `BigInteger` ms epochs via
`_ms_ts()` — `Summary.timestamp`, `ChatSession.timestamp`, `TagRun.created_at`
(*not* `updated_at_ms`), `DiscoverReport.timestamp`. The trap is that all four
*also* carry a naive `datetime` `updated_at`; mixing one in would try to unify
`TIMESTAMP` with `BIGINT` and fail at execution rather than type-check. The
union projects `updated_at` from none of them.

**Search per kind.** The rule: a leg may only search columns it is already
allowed to read. The `EXISTS`-against-the-payload-table trick from
`summaries.py:120-143` is deliberately **not** used here, because the contract
of this endpoint is that it never opens a payload table.

| kind | matches | deliberately does not match |
|---|---|---|
| summary | `text`, `channels::text`, `model`, `extra->>'note'` | `prompt_text`, `cited_posts` (payload table) |
| chat | `title`, `channels::text`, `model`, `extra->>'note'` | the transcript (payload table) |
| tag | `channels::text`, `model`, `mode`, `status` | `prompt_text`, `response_text`, `suggestions` — same table, corpus-sized, so an ILIKE detoasts the corpus of every row scanned |
| discovery | `channels::text`, `keyword` | `candidates`, copied verbatim from `discover_reports._search_clause` and its stated reason |

The summary narrowing is a real behaviour difference from
`/data/summaries?search=`, which does reach prompt bodies. It is a decision, and
the guard asserts it in both directions so it stays one.

### E. Schemas

**`backend/app/schemas/artifacts.py` — a discriminated `Union`, not one model
with optional per-kind fields.** I had proposed folding the per-kind extras into
a `counts` dict; the repo has already made this call twice against that, and the
precedent wins:

- `schemas/discover.py`'s docstring: two models "rather than one model with an
  optional `probe` because … a declared optional field serialises as an explicit
  `null` where the key is absent".
- `schemas/tag_runs.py`: "two models rather than one optional-field model, so
  the list response cannot accidentally acquire the heavy fields as `null`s."

A single model puts `messageCount: null, candidateCount: null, status: null,
mode: null` on every summary row — four wasted keys per row on a list whose
whole purpose is being small — and yields a TypeScript type where narrowing by
`kind` tells the compiler nothing.

```python
class ArtifactBase(BaseModel):
    """Closed: a projection over named columns, not a row with an `extra` bag.
    That is what keeps the unified list on the generated client."""
    model_config = ConfigDict(populate_by_name=True)
    id: str
    title: str = ""
    channels: list[str] = Field(default_factory=list)
    start_date: int = Field(default=0, alias="startDate")
    end_date: int = Field(default=0, alias="endDate")
    timestamp: int = 0
    model: str | None = None
    post_count: int | None = Field(default=None, alias="postCount")
    is_starred: bool = Field(default=False, alias="isStarred")

class SummaryArtifactResponse(ArtifactBase):
    kind: Literal["summary"]
    status: str = "complete"          # "pending" until the response is pasted

class ChatArtifactResponse(ArtifactBase):
    kind: Literal["chat"]
    message_count: int = Field(default=0, alias="messageCount")
    mode: Literal["full_scope", "semantic"] = "full_scope"

class TagArtifactResponse(ArtifactBase):
    kind: Literal["tag"]
    status: str = "pending"
    mode: str = "add"

class DiscoveryArtifactResponse(ArtifactBase):
    kind: Literal["discovery"]
    candidate_count: int = Field(default=0, alias="candidateCount")

ArtifactListItemResponse = Annotated[
    SummaryArtifactResponse | ChatArtifactResponse
    | TagArtifactResponse | DiscoveryArtifactResponse,
    Field(discriminator="kind"),
]
```

FastAPI emits `oneOf` plus a `discriminator.mapping`, and `@hey-api/openapi-ts`
turns that into a real TS discriminated union. `test_schema_aliases.py` sweeps
`app.schemas` automatically and every alias above is mechanical, so no exemption
is needed.

`backend/app/schemas/chat_sessions.py` follows `tag_runs.py`'s inheritance
direction — the smaller model is the base and the larger inherits, so
inheritance only ever *adds*. (`summaries.py` runs the other way only because
its list projection adds `chatMessageCount`; that is an artefact of `extra`, not
a convention.)

### F. Routes

Two new family modules, `routes/data/chat_sessions.py` (list / get / upsert /
delete) and `routes/data/artifacts.py` (one route). `/artifacts` gets its own
module rather than being appended to `summaries.py` precisely because it spans
four families and belongs to none.

While there: **move the four tag-run routes out of `routes/data/summaries.py`
into a new `routes/data/tag_runs.py`.** Function names do not change, so paths
and operation ids do not change, so `frontend/openapi.json` and the generated
client do not change. `test_route_inventory.py` proves nothing was dropped.

`kind` is typed `Literal["summary","chat","tag","discovery"] | None` so an
unknown value is a 422 and the generated client gets an enum. The response needs
a module-level `TypeAdapter` (an `Annotated` union alias has no
`.model_validate`); a `TypeAdapter` is not a `BaseModel` subclass, so
`test_route_module_hygiene.py` does not fire on it.

### G. Migration, backfill, downgrade

**Revision `a9b0c1d2e3f4`, `down_revision = "z8a9b0c1d2e3"` (current head).**
`upgrade()` is DDL only: create both tables and their indexes, add
`candidate_count` with a server-side `UPDATE … jsonb_array_length(...)` backfill
then drop the default (the `chat_message_count` pattern from `z8a9b0c1d2e3`),
and create the four `(timestamp DESC, id)` sort indexes.

**No chat data moves in `upgrade()`.** The move lives in
`backend/scripts/backfill_chat_sessions.py` with `--dry-run` default-safe,
`--limit`, `--batch`. Four reasons, in order of weight:

1. **It deletes user artifacts.** `scripts/prestart.sh` runs `alembic upgrade
   head` unattended on every container start. A revision that silently deletes
   `tg_summaries` rows has no operator in the loop and no way to see the count
   first. Every destructive maintenance job here is already a script with
   `--dry-run`.
2. **It is not expressible in SQL.** A summary+chat row's title comes from the
   first user message *inside a JSON array*, truncated and whitespace-collapsed
   by the same code the service uses. `z8a9b0c1d2e3` hit this for
   `prompt_excerpt`, ended up 300 lines with a hand-written mirror of
   `_derive_prompt_excerpt` and a comment about where the mirror differs. That
   is a warning, not a template.
3. **It must be resumable.** A half-finished move inside a migration leaves
   `alembic_version` behind the schema with rows already deleted. As a script it
   is idempotent per row, keyed on a deterministic session id (`summary.id` for
   chat-only, `f"{summary.id}:chat"` otherwise).
4. Reversibility stays cheap — see below.

Run it in bounded batches, not one transaction: a session held open across a
large migration pins the xmin horizon and autovacuum reclaims nothing for its
duration, the defect that left `tg_sync_meta` with 10 live and 4,743 dead rows.
The script imports `chat_sessions.upsert_chat_session` and
`summaries.apply_summary_payload` / `refresh_summary_derived_columns` rather
than writing SQL — the one-writer rule holds for scripts too, and it is how the
derived columns cannot drift.

**Downgrade is DDL plus a lossless SQL merge-back**, and the asymmetry is the
point: going up needs Python (derive a title from a JSON array), going down does
not (`'Chat: ' || title` is the exact inverse for chat-only rows, and the rest of
the transcripts just go back where they came from). So the destructive direction
is a script an operator runs and the reversal is automatic.

**Keep `chatMessages` in `summaries.PAYLOAD_COLUMNS`.** Tempting to remove now
that chats have their own table, but that would route an unrecognised
`chatMessages` key on `PUT /data/summaries/{id}` straight into `extra` —
silently reinstating the 26 MB defect, from a client this repo does not control.
It stays a recognised key (legacy storage plus the downgrade target); the live
app simply stops writing it, and "no artifact twice" holds *structurally*
because the union derives `kind="chat"` only from `tg_chat_sessions`.

### H. Non-route wiring that breaks if skipped

- `backend/scripts/tg_test_pollution.py` — add `tg_chat_session_payloads` and
  `tg_chat_sessions` to `TG_TABLES` (payload first). **`tg_tag_runs` is missing
  from that tuple today**, so tag runs are never truncated between tests. That
  is a live test-isolation hole, harmless until `/artifacts` reads the table and
  leaked rows start appearing in other tests' pages. Fix it here.
- `backend/app/services/stats.py` — `("chat_sessions", ChatSession)` in
  `_TABLE_SECTIONS`, and the payload table in `clear_table`'s explicit cascade.
- `backend/app/services/data_import_export.py` — a `chat_sessions` export
  section (outer-joined to the payload table, as summaries are at line 504) and
  an `_import_chat_sessions`. Old exports carry chats as summaries with
  `chatMessages`; route them through the same classification the backfill uses,
  so importing a pre-split export cannot recreate the duplicate.

### I. Backend sequencing

Steps 1-5 are non-destructive and independently shippable: afterwards the new
tables exist and are empty, `/artifacts` returns summaries/tags/discoveries with
zero chats, and every existing endpoint is byte-identical. **The cutover is step
6 alone.**

1. Models + revision `a9b0c1d2e3f4` + `tg_test_pollution.TG_TABLES`.
2. `services/chat_sessions.py`, `schemas/chat_sessions.py`,
   `routes/data/chat_sessions.py` — with the payload-cost guard written *first*;
   the guard is the spec.
3. The two §A fixes, with their guards.
4. `services/artifacts.py`, `schemas/artifacts.py`, `routes/data/artifacts.py`,
   and the `tag_runs.py` route move.
5. `stats.py` and `data_import_export.py` wiring.
6. `backfill_chat_sessions.py` — `--dry-run` against a staging copy, eyeball the
   counts, then run for real.
7. `bash scripts/generate-client.sh`, then the frontend half.

### J. Guard detail

Beyond the table in the body, the assertions that carry the reasoning rather
than just the state:

- **`test_each_artifact_appears_exactly_once`** — seed one of each kind plus a
  second chat extracted from a summary; the page holds five rows, and the
  summary appears once as `kind="summary"` and never as `kind="chat"`.
  Mutation: make the chat leg union in `tg_summaries WHERE text LIKE 'Chat: %'`,
  the pre-migration encoding. This is the test that says no.
- **`test_deleting_a_summary_leaves_its_chats_alone`** — the lifecycle decision
  from ADR-010, asserted rather than left as an accident of having no foreign
  key. Mutation: add a cascade.
- **`test_search_deliberately_does_not_reach_prompt_bodies`** — both directions
  in one test: `list_summaries(search="xyzzy")` still finds the prompt-only
  summary (the capability exists), `list_artifacts(search="xyzzy")` returns `[]`
  **and** opened no payload table doing so. Mutation: add the payload `EXISTS`
  to the summary leg — the first assertion keeps passing, the other two fail,
  which is what makes the narrowing a decision rather than a bug.
- **`test_the_detail_call_does_touch_it_and_that_is_why_the_list_need_not`** —
  asserts three things together: the detail transcript is correct, the payload
  table *is* in the captured SQL, and the list row carries no `messages` key
  while `messageCount == len(detail["messages"])` and `title` is non-empty. The
  third clause is the reason: the derived columns are what stand in for the
  table the list skips, so a guard pinning only the first two would still pass
  if the derived columns went stale and the list quietly became useless.
- **`test_the_forbidden_set_is_not_silently_empty`** — without it, every
  column-cost assertion passes vacuously on an empty frozenset. Mirrors the
  existing `test_the_heavy_sets_are_not_silently_empty`.
- **`test_the_kind_filter_removes_the_table_from_the_plan`** — mutation: filter
  on `u.c.kind` in the outer select instead of skipping the leg.
- **`test_ordering_is_stable_across_pages`** — 40 artifacts with colliding
  timestamps; concatenated pages equal one big page. Mutation: drop the `, id`
  tiebreaker.
- **`test_discover_report_list_column_cost`** — `list_reports` emits SQL not
  naming `candidates`, *and* `candidateCount` still equals
  `len(get_report(...)["candidates"])`. The second half is the reason clause:
  the count may come from a column only because it provably equals the thing it
  replaced.

Reuse the `captured_sql()` contextmanager verbatim from
`test_summary_list_payload_cost.py`. It is already duplicated into
`test_log_list_payload_cost.py`; a third copy matches the precedent — do not
extract a shared helper just to avoid three copies.
