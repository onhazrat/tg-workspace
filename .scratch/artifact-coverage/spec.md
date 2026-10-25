# Spec: An Artifact's prompt reads its Covered Posts

Status: ready-for-agent

Decisions: `docs/adr/ADR-038-prompts-read-covered-posts.md` and
`docs/artifact-coverage-plan.md` (19 settled decisions). Prototype:
`prototype/artifact-coverage`, variant 2 chosen. Vocabulary (Artifact, Scope, Covered Post,
Missing Post, Post selection, Selection rule, Pick, Analysis window, Summary, Chat, Tag run,
Discovery report, Attempt, Pending, Failed, Follow, Selected posts, Semantic) is
`CONTEXT.md`'s. Ticket ids carry the prefix `AC`.

## Problem Statement

An Artifact records exactly which Posts it covered, and the coverage wall shows that list.
The prompts built for it do not read that list. They rebuild "the Posts this Artifact
covers" four different ways, and the four disagree:

- A Retry or a copied prompt applies the Artifact's Selection rules again, against today's
  corpus. Posts synced into the window after the freeze, or view counts that reorder a
  "top 50 by views" rule, change what the model reads, while the coverage wall still shows
  the original list.
- A Summary the scheduler regenerates gets a different prompt from the same Summary
  regenerated in the browser. The scheduler reads every Post of the predecessor's Channels
  with no Follow scoping, no limit on Posts or tokens, and a formatter that drops the media
  hints.
- A Chat's later turns read whatever the Posts tab selects now. A Chat opened on Monday
  answers Thursday's question about Thursday's selection, while its header still shows
  Monday's Scope. Tag runs and copied prompts take their Posts from the browser the same
  way.
- When a Covered Post can no longer be read (retention reclaimed it, or the Account
  unfollowed its Channel), the prompt quietly covers fewer Posts than the Artifact lists,
  and nothing tells the reader. On staging, eight Summaries already cover between 36 and 88
  Posts that no longer exist.

## Solution

Every prompt an Artifact sends reads that Artifact's Covered Posts and no others, whoever
starts it: Generate, Retry, the scheduler, a Chat turn, a Tag run, or a copied prompt. The
browser names the Artifact, and the server reads what it froze. A Scope with no Posts on
record (a regeneration, or an Artifact made before Post selections existed) covers its
window, and a regeneration then records what it covered. A Covered Post that can no longer
be read is left out and counted, and the Artifact shows "N missing" in its Scope line,
explained on tap.

## User Stories

1. As an Account, I want a Retry of a Failed Summary to read the same Posts its coverage wall lists, so that the report I get matches what the Summary says it covers.
2. As an Account, I want a Summary's prompt to ignore Posts that synced into its window after I asked for it, so that the Summary covers what I chose at that moment.
3. As an Account, I want a "top 50 by views" Selection rule to keep the 50 Posts it reached when I made the Summary, so that view counts moving later do not change what the Summary covers.
4. As an Account, I want a Summary the scheduler regenerates to get the same prompt as the same Summary regenerated from the browser, so that an automatic chain and a manual one read the same Posts.
5. As an Account, I want a scheduled regeneration to read only Posts of Channels I follow, so that it never summarises a Channel I unfollowed.
6. As an Account, I want a scheduled regeneration's prompt to carry each Post's media hints, so that the model knows a Post had a photo or a video, as it does on Generate.
7. As an Account, I want a scheduled regeneration whose window holds more Posts than one prompt can take to become a Failed Summary that says why, so that it never sends an unbounded prompt on my Key.
8. As an Account, I want a scheduled regeneration whose window has no Posts to say "No new posts found" and spend nothing, so that a quiet day costs nothing and the chain keeps moving.
9. As an Account, I want each later turn of a Chat in Selected posts mode to read the Chat's own Covered Posts, so that the conversation stays about the Posts it started from.
10. As an Account, I want changing the Posts tab's selection to leave my open Chats unchanged, so that I can read around without changing what an existing Chat is about.
11. As an Account, I want a Chat in Semantic mode to keep retrieving Posts for each question, so that meaning search works as it does today.
12. As an Account, I want a Tag run's prompt to read the Tag run's Covered Posts, so that the suggestions come from the Posts the run records.
13. As an Account, I want a copied Summary prompt to read the Summary's Covered Posts, so that a response I paste back belongs to the Summary it completes.
14. As an Account, I want a copied Tag run prompt to read the Tag run's Covered Posts, so that the pasted suggestions match the run.
15. As an Account, I want a Discovery report to scan exactly the Posts it records as covered, so that its Candidates come from its own coverage.
16. As an Account, I want an Artifact made before Post selections existed to cover its whole window when I retry or continue it, so that old Artifacts keep working as they do today.
17. As an Account, I want a regenerated Summary to record the Posts its prompt covered, so that its coverage wall lists them.
18. As an Account, I want a prompt to leave out Covered Posts that retention reclaimed, so that a Summary older than retention can still be retried.
19. As an Account, I want a prompt to leave out Covered Posts of Channels I no longer follow, so that an Artifact never reads Posts I can no longer see.
20. As an Account, I want to see how many Covered Posts were missing from an Artifact's prompt, so that I know the answer rests on fewer Posts than the Artifact lists.
21. As an Account, I want that count beside the Scope's other numbers, as an "N missing" chip, so that I read it with the Channel and Post counts it qualifies.
22. As an Account, I want to tap the chip and read why Posts go missing, so that I can follow a Channel again if that is the reason.
23. As an Account, I want no chip when nothing is missing, so that the Scope line stays as it is for almost every Artifact.
24. As an Account, I want the chip on a Summary's header, so that I see it before I read the report.
25. As an Account, I want the chip in a Chat's Scope line, counting what the latest answer left out, so that I know how many Posts the conversation is missing now.
26. As an Account, I want the chip in a Tag run's Scope line, so that I know the suggestions rest on fewer Posts.
27. As an Account, I want a Summary's Missing Post count to stay with the prompt it describes, so that a Retry that reuses the prompt reports the same count.
28. As an Account, I want a regenerated Summary not to inherit its predecessor's Missing Post count, so that each Summary reports its own.
29. As an Account, I want the Post count an Artifact records to be the number of Posts it covers, so that the header's "N posts" never disagrees with the coverage wall.
30. As an Account, I want a prompt route given another Account's Artifact to answer as if the Artifact did not exist, so that nobody learns another Account's Artifacts exist.
31. As an Owner in a View-as session, I want a prompt route to read the target Account's Artifact under the same rules as the target, so that View-as sees what the target would see.
32. As an Account with a browser tab left open across a deploy, I want an outdated prompt request to fail clearly, so that one reload fixes it and nothing runs over the wrong Posts.
33. As an Account, I want the Covered Posts read in the order they were recorded, so that a Summary grouped by Channel or sorted by views keeps that order in its prompt.
34. As an Account, I want the 10,000-Post and token limits to apply to every prompt, Chat and Tag run included, so that no path can send an oversized prompt.
35. As an Operator, I want the unused Generate route that read a Scope from the request removed, so that no path spends a Key over a Scope the browser states.
36. As an Operator, I want a guard that fails when a prompt path builds its own Post read, so that the four paths cannot drift apart again.
37. As a maintainer, I want one module that answers "which Posts does this Artifact cover", so that a change to coverage happens in one place.
38. As a maintainer, I want one parity test of the scheduled and the browser regeneration, so that a divergence between them fails the suite instead of reaching staging.

## Implementation Decisions

- **One read model, the Artifact coverage module.** It owns: freezing a submission (moved from the Posts view's `freeze_selection`), the Covered Posts of a frozen Scope for an Account, the prompt block in the flat or the tag layout, and a predicate over the frozen refs that a Discovery report scans by. It takes a `FrozenScope` with its refs loaded. Each family's aggregate keeps loading its own row and payload, so the module never names the four Artifact tables. It is declared as a read model in the service-kinds inventory.
- **Which Posts.** With refs on record, the Covered Posts are those refs, read in recorded order through the Follow-scoped seam, with fresh text. With no refs (a derived Scope, or one frozen before PTR-05), they are every Post in the frozen window under select all, in the Scope's order. A ref that does not come back is a Missing Post.
- **The limits move into the module.** The 10,000-Post limit and the token budget (both 413) apply in the prompt block for every caller.
- **`PromptScope`, `PromptScopeInput`, `_fetch_scoped_posts` and `_resolve_posts_text` go.** Generate and Retry build through the module from the Summary's frozen Scope.
- **The scheduler goes through the browser's door.** It opens the successor with `submit_summary(derived_from=successor, extra=…)`, carrying the chain's flags in `extra` as today, then asks the module for the Covered Posts. With none, it writes the "No new posts found between …" text and starts no Attempt. Otherwise it starts a scheduled Attempt, and `start_attempt` builds and stores the prompt, recording the refs on the derived Scope as `store_prompt` does today.
- **The `/ai` prompt routes name the Artifact.** `/ai/summary/prompt` takes `summaryId`, `/ai/tag/prompt` and `/ai/tag/stream` take `tagRunId`, `/ai/chat/stream` takes `chatId`. Each reads the Artifact through its family's by-id read guard and answers that family's 404 for an absent or foreign id. Each refuses a `scope` field with a 422 (`extra="forbid"`), with no compatibility shim. Semantic Chat still sends `postsText`, which wins as it does today. Each response carries the Missing Post count: a field on the two prompt responses, and an event on the two streams before the text.
- **`POST /ai/summary` is deleted**, with its rows in the route inventories, the View-as spend list, the isolation probes and the generated client.
- **The browser sends ids.** The AI, Chat and Tag contexts send the Artifact's id after opening it, and `frozenScope` goes. The browser's `postCount` stays only for its "no Posts selected" check and is no longer submitted; an Artifact records the refs' count (`scopedPostCount`).
- **A Discovery report scans by the refs predicate** instead of resolving its selection a second time. The Discover aggregate's own window and scoping code are untouched.
- **Where the Missing Post count is stored.** Beside the prompt it describes, with no migration. A Summary: `extra.missingPosts`, written by `store_prompt`, and listed in the keys a regeneration does not inherit. A Tag run: `extra.missingPosts`, written by the browser with the `promptText`, from the route's answer. A Chat: `missingPosts` on the answer message, written by the browser into the transcript it already saves. Zero is never stored. One number; no per-Channel or per-reason split.
- **How the reader sees it** (prototype variant 2). An "N missing" chip after the Scope's other numbers: in the Summary header after "N channels · N posts", and in every Artifact's Scope line. The Chat's Scope line shows the newest answer's count. Tapping the chip explains it. The prototype's text was "88 Covered Posts of 1,316 are missing. Retention reclaimed them, or you no longer follow their Channel. They are still listed as covered; the prompt left them out." The explanation must stay inside the viewport at phone width; the prototype's popover, anchored at the header's right end, did not. The coverage wall does not mark which refs are missing.
- **A guard.** The Posts view guard widens: any Action-path module (Summary generation, the scheduler's regeneration, the AI routes, Discovery reports, Chat sessions, Tag runs, Summaries) that names `resolve_posts_view`, `apply_analysis_window` or `select(Post)` fails. It gets a row in the guard table.
- **Docs.** `backend/CLAUDE.md` says the Action path reads through the Artifact coverage module.

## Testing Decisions

A good test here states a fact about Posts and prompts that an Account could observe: which Posts a prompt holds, in what order, what count it reports, what a route answers. It never asserts which internal function ran. Three seams, highest first:

- **The prompt an Artifact gets, through its existing doors.** Summaries through `submit_summary` and `start_attempt` (the stored prompt and Scope), the scheduler through `_regenerate_one`, and Chat, Tag run and copied prompts over HTTP. Prior art: the scheduler-versus-browser tests in the regenerated-coverage service tests, and the AI summary, tag and chat-stream API tests. The first test written, red today: one predecessor regenerated by the scheduler and by `derived_from` plus `start_attempt` builds byte-identical prompts. It replaces the old autoregen scope-parity API test, which pins a path that no longer exists. Also here: a foreign Artifact id answers the family's 404; a request with `scope` answers 422; a Chat turn after the Posts tab's selection changed reads the frozen Covered Posts; a Tag prompt reads the run's; zero Covered Posts gives the "No new posts found" Summary and no Attempt; an oversized scheduled window ends Failed with the 413's reason; `POST /ai/summary` is gone.
- **The Artifact coverage module's interface**, for cases that are expensive at the doors: refs win over Selection rules (a Post synced into the window after the freeze is not read, and a reordered views ranking keeps the frozen Posts); a derived or pre-PTR-05 Scope covers its window; recorded order is kept; a reclaimed Post and an unfollowed Channel's Post are each counted missing; the 10,000-Post and token 413s; the report predicate matches exactly the refs. Prior art: the Posts view interface tests. These replace the prompt-assembly service tests and the prompt-scope-shape API tests.
- **The browser.** A render test of the chip in the Scope line and the Summary header: absent at zero, "N missing" otherwise, the explanation on tap. Prior art: the summary-view component tests. A unit test that the AI, Chat and Tag paths send the Artifact id and no `scope`, replacing the `frozenScope` tests in the artifact-run tests.
- **The guard is mutation-checked** by restoring the scheduler's inline Post read, and the check is written into the commit body.
- The Playwright suites run unchanged, apart from mocks of the four `/ai` routes, which change with the request body.

## Out of Scope

- The Discover aggregate's own window and scoping code (architecture candidate 3).
- Moving the Posts view out of `ScraperContext` (architecture candidate 2).
- A per-Channel or per-reason breakdown of Missing Posts (prototype variant 3).
- Marking Missing Posts on the coverage wall.
- Rebuilding a pre-PTR-05 Artifact's old flat filters as a Selection rule.
- Bounding or moving the frozen refs column (the existing `ponytail:` note on `freeze_selection` stands).

## Further Notes

- The behaviour change most likely to be "fixed" back: a Retry no longer picks up Posts synced into the window after the freeze. ADR-038 records why.
- Measured on staging, 2026-10-26: one Account's eight Summaries with Missing Posts, up to 88 of 1,316. In the largest, all 88 are one Channel nobody follows any more, which retention then reclaimed whole. No Chat or Tag run on staging records refs yet.
- The `/ai` request bodies change with no shim, so the server and the browser land in one PR, built on one integration branch.
