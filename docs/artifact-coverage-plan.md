# An Artifact's prompt reads its Covered Posts: plan

Decision: [ADR-038](adr/ADR-038-prompts-read-covered-posts.md). Glossary: **Missing Post**,
and **Covered Post** sharpened, in `CONTEXT.md`. Origin: candidate 1 of the 2026-10-25
architecture review ("Artifact coverage"), grilled 2026-10-25 and 2026-10-26. Prototype:
`prototype/artifact-coverage`, variant 2 chosen on 2026-10-26.

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | A prompt reads the frozen refs when the Scope has them; otherwise the window with select all, and a regeneration then records what it covered | Re-apply the Selection rules to today's corpus; rewrite the refs on every prompt |
| 2 | The scheduler opens its successor through `submit_summary(derived_from=…)` and `start_attempt` builds the prompt | Its own read with the shared formatter |
| 3 | A Chat turn, a Tag run and a copied prompt read their own Artifact's coverage, named by id; Semantic Chat keeps sending `postsText` | Today's selection with the frozen window |
| 4 | This effort includes `create_report`'s second resolve; the Discover aggregate's own window and scoping code stay for candidate 3 | All of Discover here |
| 5 | A Scope frozen before PTR-05 covers its window with select all, as Retry does today | Refuse; rebuild the old filters as a Selection rule |
| 6 | One read model, `services/artifact_coverage.py`: `freeze`, `covered_posts`, `posts_block(layout)`, and a refs predicate for the report; it takes a `FrozenScope` with refs loaded and never names the four tables | One module per family; taking an Artifact row |
| 7 | `/ai/summary/prompt`, `/ai/tag/prompt`, `/ai/tag/stream`, `/ai/chat/stream` take `summaryId` / `tagRunId` / `chatId` in place of `scope`, read through the family's by-id guard, with no shim | Accept `scope` for one release |
| 8 | Delete `POST /ai/summary`: no browser caller since ADR-030 | Keep it |
| 9 | A Missing Post is skipped and counted | Skip in silence; refuse the prompt |
| 10 | The count sits beside the prompt it describes: Summary `extra.missingPosts` (server, in `store_prompt`, and in `_NOT_INHERITED`), Tag run `extra.missingPosts` and Chat answer `missingPosts` (browser, from the route); no migration; zero not stored | A column on `SummaryAttempt` (a Retry reuses the stored prompt, so the count belongs to the prompt); Summaries only |
| 11 | Name: **Missing Post** | Deleted, lost, stale ref |
| 12 | One count, no reason | Retention and unfollow counted apart |
| 13 | First red test: a scheduled and a browser regeneration of one predecessor build byte-identical prompts; it replaces `test_autoregen_scope_parity.py` | Keep the old parity test |
| 14 | Guard: `test_posts_view_guard.py` fails any Action-path module (`summary_generation`, `auto_summary`, `ai_routes`, `discover_reports`, `chat_sessions`, `tag_runs`, `summaries`) naming `resolve_posts_view`, `apply_analysis_window` or `select(Post)`; mutation-checked by restoring the scheduler's inline read | Prose rule |
| 15 | ADR-038 | |
| 16 | A docs PR (glossary, ADR, plan, spec, tickets), then `/implement-spec` on one integration branch as one PR: decision 7 makes the wire and the browser one change | Split by tier, as ADR-036 did |
| 17 | An Artifact records the refs' count; the browser's `postCount` stays only for its "no Posts selected" check | The browser's count when it sends one |
| 18 | The reader sees an "N missing" chip beside the Scope's other numbers, in the Summary header and in every Artifact's Scope line, explained on tap (prototype variant 2) | A line beside the answer (variant 1); a per-Channel panel (variant 3) |
| 19 | The coverage wall does not mark which refs are missing | A second read on every open |

## What changes for an Account

- A Retry or a copied prompt covers exactly the Posts the Artifact lists. Posts synced into
  the window after the freeze are not picked up.
- A Chat's later turns answer from the Chat's own Covered Posts, whatever the Posts tab
  shows now.
- A scheduled regeneration's prompt gains the media hints and Follow scoping, and a chain
  whose window outgrows the 10,000-Post or token limit becomes a Failed Summary.
- An Artifact whose Covered Posts were reclaimed or unfollowed shows "N missing" in its
  Scope line.

Measured on staging, 2026-10-26: eight of one Account's Summaries already have Missing
Posts, up to 88 of 1,316. In the largest, all 88 are one Channel nobody follows any more,
which retention then reclaimed whole.

## Steps

The spec and tickets come from `/to-spec` and `/to-tickets`; this is the order they should
respect.

- [ ] Parity test, red: scheduled and browser regeneration of one predecessor, compared
      prompt for prompt
- [ ] `artifact_coverage.py` (read model, declared in `test_service_kinds.py`) with
      `freeze` (moved from `posts_view.freeze_selection`), `covered_posts`, `posts_block`;
      interface tests: refs win over rules, legacy and derived Scopes cover the window,
      a foreign or unfollowed Channel's Post is missing, order is the recorded order, the
      413s
- [ ] Generate and Retry build through it; `PromptScope` and `_fetch_scoped_posts` go
- [ ] The scheduler opens its successor through `submit_summary(derived_from=…)`; zero
      Covered Posts keeps the "No new posts found" text; the parity test goes green
- [ ] The four `/ai` routes take the Artifact id; `PromptScopeInput` and
      `_resolve_posts_text` go; `POST /ai/summary` is deleted; `bash scripts/route-guards.sh`
      and `bash scripts/generate-client.sh`
- [ ] Browser: AI, Chat and Tag contexts send the id; `frozenScope` goes; `postCount` is no
      longer stored
- [ ] `create_report` scans by the refs predicate
- [ ] Missing Posts: counted in `posts_block`, stored per decision 10, shown per decision 18;
      a render test for the chip
- [ ] Guard widened and mutation-checked; a row in `docs/agents/architecture-guards.md`
- [ ] `backend/CLAUDE.md`: the Action path reads through `artifact_coverage`

Verification per step: `cd backend && uv run pytest tests/services/test_artifact_coverage.py
tests/jobs -q`, `bash scripts/route-guards.sh`, `bun run --filter tg-summarizer-frontend
test:unit`, and the full backend suite before the PR.

## Out of scope

- The Discover aggregate's own window and scoping code (candidate 3)
- Moving the Posts view out of `ScraperContext` (candidate 2)
- A per-Channel or per-reason breakdown of Missing Posts
- Marking Missing Posts on the coverage wall
