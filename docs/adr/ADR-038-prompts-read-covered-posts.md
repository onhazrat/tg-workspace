# ADR-038: An Artifact's prompt reads its Covered Posts

**Status:** Accepted (2026-10-26). Extends ADR-026. Plan: `docs/artifact-coverage-plan.md`.
Prototype: `prototype/artifact-coverage` (variant 2 chosen).

## Context

ADR-026 made an Artifact freeze every Post its Post selection reached, so it "can be
inspected without re-applying anything against today's corpus". The inspection side kept
that promise. The prompt side never read the record back. Four paths turned a frozen Scope
into a prompt, and they disagreed:

- **Generate and Retry** (`summary_generation._prompt_from_scope`) re-applied the frozen
  Selection rules to the frozen window against today's corpus. A sync that added Posts
  inside the window after the freeze, or view counts that reordered a "top N" rule,
  changed what the prompt read while the coverage wall still showed the old list.
- **The scheduler's regeneration** (`auto_summary._regenerate_one`) read Posts with a raw
  `select(Post)` over the predecessor's Channels: no Follow scoping, no 10,000-Post or
  token limit, anchors left out, and its own formatter without the media hints. The same
  successor got a different prompt when the browser regenerated it.
- **Chat turns, Tag runs and the copied prompt** (`/ai/*`) took a Scope from the browser:
  today's Post selection and selected Channels, with only the window swapped for the
  frozen one by `frozenScope`. A Chat opened on Monday answered Thursday's question about
  Thursday's selection while its header showed Monday's Scope.
- **A Discovery report** resolved its selection twice in one request.

`PromptScope` and `PromptScopeInput` existed to carry a Scope between these paths, and
`_fetch_scoped_posts` re-validated what they had thrown away.

## Decision

- **A prompt reads the Artifact's Covered Posts**: the frozen refs when the Scope has
  them; otherwise, for a regeneration or a Scope frozen before PTR-05, the window with
  select all, after which a regeneration records what it covered. Post text is read fresh.
- **One read model, `services/artifact_coverage.py`**, answers it: `freeze`,
  `covered_posts` and `posts_block` (flat or tag layout, owning the 10,000-Post and token
  limits), plus a predicate a Discovery report scans by. It takes a `FrozenScope` with its
  refs loaded; each family's aggregate loads its own row.
- **The scheduler goes through the browser's door**: it opens the successor with
  `submit_summary(derived_from=…)` and `start_attempt` builds the prompt. A successor
  with no Covered Posts keeps the "No new posts found" text and starts no Attempt.
- **The `/ai` prompt routes name the Artifact, not a Scope.** `/ai/summary/prompt`,
  `/ai/tag/prompt`, `/ai/tag/stream` and `/ai/chat/stream` take its id, read it through the
  family's by-id guard, and refuse `scope`. Semantic Chat still sends the Posts it
  retrieved. The dead `POST /ai/summary` is deleted.
- **A Missing Post is skipped and counted.** The count is stored beside the prompt it
  describes: a Summary's `extra.missingPosts` (by `store_prompt`), a Tag run's
  `extra.missingPosts` and a Chat answer's `missingPosts` (by the browser, from the
  route's answer). One number, no reason. Zero is not stored.
- **The reader sees it in the Scope line**: an "N missing" chip beside the Scope's other
  numbers, in the Summary header and in every Artifact's Scope line, explained on tap.
- **An Artifact records the refs' count**, never the browser's `postCount`.

## Alternatives considered

- **Keep re-applying the rules and rewrite the refs on every prompt.** Rejected: the
  record would stop being a record, and a Retry would silently cover different Posts.
- **A Chat turn reads today's selection.** Rejected: the frozen Scope would describe only
  the first turn.
- **The scheduler keeps its own read with the shared formatter.** Rejected: it fixes the
  formatting and leaves the Follow scoping and the limits divergent.
- **Accept `scope` on the `/ai` routes for one release.** Rejected: both halves deploy
  together; a tab left open across a deploy reloads once.
- **Refuse a prompt with Missing Posts.** Rejected: every Artifact that outlives retention
  could no longer be retried or continued.
- **Skip Missing Posts in silence.** Rejected: the prompt would cover fewer Posts than the
  Artifact lists, with nothing saying so.
- **Count per Channel, or say why each is missing.** Deferred until someone asks. The
  prototype's per-Channel panel (variant 3) said the most and cost the most.
- **A line beside the answer** (variant 1) instead of the chip. Rejected in the prototype.

## Consequences

- A Retry no longer picks up Posts synced into the window after the freeze. That is the
  point, and the change most likely to be "fixed" back.
- A Chat's later turns read the Chat's own Covered Posts whatever the Posts tab shows.
- A scheduled chain whose window outgrows the 10,000-Post or token limit becomes a Failed
  Summary instead of sending an unbounded prompt.
- `PromptScope`, `PromptScopeInput`, `_resolve_posts_text` and the browser's
  `frozenScope` go. `test_autoregen_scope_parity.py` is replaced by a parity test of the
  two regeneration paths, and `test_posts_view_guard.py` widens to the Action path.
