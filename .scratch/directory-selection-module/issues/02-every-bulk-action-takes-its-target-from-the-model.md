# DSM-02: Every bulk action takes its target from the model

**What to build:** The model answers what a bulk action acts on, the selected
handles or the view under All matching, and one function turns that target
into a write's `handles` or `view` half. Dismiss, Tag, Untag, Priority boost
and Refresh target all use it, so the top-level Directory component no longer
chooses between the Directory selection and the view. A guard keeps the choice
from coming back. Every request sent is the one sent today.

Spec: `.scratch/directory-selection-module/spec.md` (user stories 10, 11, 19
to 21, 24, 27, 29, 30, 32). Glossary: Directory selection, All matching.
ADR-031: each write takes exactly one of `handles` or `view`.

**Blocked by:** DSM-01.

**Status:** ready-for-agent

- [ ] A selector answers the bulk action's target: the selected handles, or the view while All matching is held.
- [ ] One function turns a target and the view request into the `handles` or `view` half of a write body. Dismiss, Tag, Untag, Priority boost and Refresh target use it.
- [ ] The separate dismiss-all function and the `handles | "all"` parameter are gone. The Tags hook takes a target through one tagger; its second, view-only tagger is gone.
- [ ] Dismiss under All matching still has no Undo and still reports the count the server acted on; Dismiss of selected entries keeps its Undo. Follow stays off under All matching.
- [ ] Row and detail-panel actions name their one handle and never read the bulk target.
- [ ] `bun test` covers the target as handles and as the view for each of Dismiss, Tag, Untag, Priority boost and Refresh target, and Follow refused a view.
- [ ] The Directory Playwright spec keeps every case. The All matching and tag-the-selection cases lose their request-body assertions to `bun test` and keep one assertion each that the gesture reaches the server with a view or with handles. No request body the spec records changes.
- [ ] A guard in the frontend's architecture invariants fails when a component chooses a write's target. The bulk bar's read of the selector's description, to render its text and switch Follow off, stays allowed.
- [ ] The guard's mutation is in `docs/agents/guard-mutations.json`, the guard has a row in `docs/agents/architecture-guards.md`, and `frontend/CLAUDE.md` gets one bullet naming the module and the guard.
- [ ] The commit body carries the `Mutation-checked:` line from `scripts/mutate.py`.
- [ ] Frontend unit tests, typecheck, biome and the Directory Playwright spec pass; no backend, schema or generated-client file changes.
