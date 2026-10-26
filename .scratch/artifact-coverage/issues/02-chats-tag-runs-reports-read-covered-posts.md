# AC-02: Chats, Tag runs and Discovery reports read their Covered Posts

**What to build:** a Chat's every turn in Selected posts mode, a Tag run's prompt and stream,
and a Discovery report's scan read that Artifact's own Covered Posts, never the Posts tab's
selection of today. Changing the Posts tab leaves an open Chat about the Posts it started
from. Missing Posts are left out and counted, and a Chat's or Tag run's Scope line shows
"N missing". After this ticket no Action path takes a Scope from the browser. Spec:
`.scratch/artifact-coverage/spec.md`; decisions: ADR-038 and
`docs/artifact-coverage-plan.md`.

**Blocked by:** AC-01 (the Artifact coverage module and the chip)

**Status:** done

- [x] `/ai/chat/stream` takes `chatId`, and `/ai/tag/prompt` and `/ai/tag/stream` take `tagRunId`; each reads the Artifact through its family's by-id read guard (its 404 for an absent or foreign id), refuses `scope` with a 422, and builds the posts block through the module in the flat (Chat) or tag (Tag run) layout; Semantic Chat's `postsText` still wins
- [x] Each route answers the Missing Post count: a field on the tag prompt response, an event before the text on both streams
- [x] HTTP tests: a Chat turn after the Posts tab's selection changed reads the Chat's frozen Covered Posts; a Tag prompt reads the run's; a foreign id answers 404; `scope` answers 422. They replace the prompt-scope-shape API tests.
- [x] The AI, Chat and Tag contexts send the Artifact's id and no `scope`; `frozenScope` and `PromptScopeInput` are gone; a unit test pins the bodies, replacing the `frozenScope` tests
- [x] The browser stores the count above zero: `missingPosts` on the Chat answer message, `extra.missingPosts` on the Tag run with its `promptText`
- [x] The chip shows in a Chat's Scope line (the newest answer's count) and a Tag run's Scope line, with render tests
- [x] A Discovery report scans by the module's refs predicate instead of resolving its selection a second time; the Discover aggregate's own window code is untouched
- [x] The guard widens to the AI routes, Discovery reports, Chat sessions and Tag runs; mutation-checked by naming `resolve_posts_view` in the AI routes, written into the commit body
- [x] `backend/CLAUDE.md` says the Action path reads through the Artifact coverage module
- [x] Backend suite, backend lint, frontend unit tests and typecheck pass; Playwright mocks of the chat and tag routes follow the new bodies

## Comments

- 2026-10-26: implemented on `ac-02-chats-tags-reports-covered-posts` and merged into the integration branch in 90c1523b (fast-forward).
  Also: `ChatRequest` and `TagRequest` refuse the old `channels` field, and `TagRequest` refuses `postsText`. No `/ai/chat/stream` Playwright mock existed to update.
