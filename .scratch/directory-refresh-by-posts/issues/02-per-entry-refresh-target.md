# DRP-02: Operators set a Refresh target per entry or per view

**What to build:** The Operator overrides the Refresh target on one Directory
entry, on a selection, or on every entry a Directory view matches. They can
also clear it so the entry follows the deployment's target again. The entry's
due date moves at once, still clamped by the deployment's shortest and longest
waits. The controls sit beside the Priority boost. Two optional, sortable
Directory columns show what is set and when each entry is next fetched:
Refresh target (the override, or the deployment's value greyed) and Next
refresh. The spec is `.scratch/directory-refresh-by-posts/spec.md`. DRP-01
already added the `refresh_target` column and honours it in every due-date
computation.

**Blocked by:** DRP-01 (Entries come due by expected new posts).

**Status:** done

## Acceptance criteria

- [ ] The Directory aggregate has one operation that sets or clears the target on a list of handles or a Directory view statement, mirroring the Priority boost's operation. It is all or nothing and validates 1 to 1000 before writing. It skips handles the Directory does not hold, commits, and returns how many entries changed.
- [ ] The operation recomputes the changed entries' due dates. An entry made due on demand stays due, and dead entries get no due date.
- [ ] A route beside the boost route, gated by the same permission, sets or clears the target. It answers 422 with nothing changed for an out-of-range value or an empty handle list. It joins every route inventory, and the generated client is regenerated.
- [ ] The Directory list and detail reads expose the override (null when unset) and the due date.
- [ ] The Directory lets the Operator set and clear a target on one entry and on the selection or view, beside the Priority boost.
- [ ] Two optional, sortable columns go through the existing columns machinery: Refresh target (override, or the deployment's greyed) and Next refresh.
- [ ] There are route tests for set and clear on handles and on a view, refusal without the permission, 422 with nothing changed, and a per-entry target moving only its entry and still clamped. There are component tests for set and clear and the two columns. Each new assertion is mutation-tested with `scripts/mutate.py`.
- [ ] `cd backend && uv run prek run --all-files`, the backend suite, and the frontend unit tests and typecheck pass.

## Comments

- 2026-11-03: implemented on `claude/drp-02-implementation-ff1350` and merged into `main` in eced4961 (#263).
  Closed in a sweep of stale Status lines; the Status line was never updated at merge.
