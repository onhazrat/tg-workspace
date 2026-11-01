# Codex continuity

Use the shared specs, tickets, and comments regardless of which agent wrote them.
Follow `docs/agents/issue-tracker.md` for locations, ticket format, and closure,
and `docs/agents/triage-labels.md` for status meanings. These instructions apply
to Codex; continuity work leaves Claude's instructions, settings, and hooks intact.

## Start or resume

1. Read the active ticket, its parent spec, and its comments, including the most
   recent progress notes. Preserve the task's agreed scope and user constraints.
2. Confirm the actual worktree, branch, HEAD, and uncommitted changes. A note
   naming another checkout is a pointer to inspect, not permission to overwrite
   the current checkout or another agent's work.
3. Compare saved progress with current source and relevant checks. Distinguish
   implementation, local verification, CI, merge, and deployment. Verify the
   current PR or deployment state when the next action depends on it.

## Record progress

After meaningful progress and before handing off unfinished work, append a
dated note under the existing ticket's `## Comments`. Use ordinary prose that
either agent can understand, retaining older comments and the existing format.
Include the checkout and branch, relevant commit, completed and remaining work,
uncommitted file paths, verification commands and outcomes, untested behavior,
material decisions or constraints, and one concrete next action. Reference
existing requirements and detailed evidence instead of repeating them.

Record lasting technical decisions in the relevant project documentation or ADR
when the task calls for it. Keep current execution state in the shared ticket;
do not introduce agent-specific ticket formats or separate handoff files.

Small completed tasks need no new ticket. If unfinished unticketed work needs a
durable handoff, create the smallest ticket using the existing tracker format.
