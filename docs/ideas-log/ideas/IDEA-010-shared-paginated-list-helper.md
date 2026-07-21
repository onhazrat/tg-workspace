# IDEA-010: A shared paginated-list helper so the pattern stops being copy-pasted

| Field | Value |
|-------|-------|
| **Id** | IDEA-010 |
| **Status** | backlog |
| **Added** | 2026-07-21 |
| **Priority** | medium |
| **Area** | backend |

## Problem

The codebase now has the same paginated-list shape written out four separate times:

- `backend/app/services/logs.py` — `_list_logs_page`, `DEFAULT_LOG_PAGE_SIZE` / `MAX_LOG_PAGE_SIZE`
- `backend/app/services/posts.py` — `list_posts`, `DEFAULT_POST_PAGE_SIZE` / `MAX_POST_PAGE_SIZE`
- `backend/app/services/data_vectors.py` — `list_translations`, `DEFAULT_VECTOR_PAGE_SIZE` / `MAX_VECTOR_PAGE_SIZE`
- `backend/app/services/tag_runs.py` — `list_tag_runs`, `DEFAULT_TAG_RUN_PAGE_SIZE` / `MAX_TAG_RUN_PAGE_SIZE`

Each is: order by a timestamp column descending, apply `.offset().limit()`, serialize.
Each route then repeats `limit: int = Query(default=..., ge=1, le=MAX)` and
`offset: int = Query(default=0, ge=0)`.

**This duplication is not cosmetic — it has already caused a real bug.** The bulk-delete
fix made in `stats.py` never propagated to `logs.py` precisely because there was no shared
helper connecting them; `logs.py` kept doing fetch-then-Python-loop deletes long after the
lesson had been learned once. The same failure mode now applies to pagination: a future
fix or hardening applied to one of these four will not reach the other three.

The `/items` and `/users` routers additionally still use the *template's* different
convention (`skip`/`limit` plus a count wrapper), so there are really two competing
conventions in the same codebase.

## Proposed direction

1. Extract a helper — roughly
   `paginated(session, model, *, order_by, to_camel, limit, offset)` — and route all four
   call sites through it.
2. Extract the route-level parameter declaration too, e.g. a `PageParams` dependency, so
   the `ge`/`le` bounds are declared once rather than per route.
3. Decide deliberately between the two conventions: bare list (what `/data/*` returns
   today, which the frontend depends on) versus the template's `{data, count}` wrapper.
   Changing the `/data/*` shape is a frontend-visible break, so this likely means
   documenting the bare-list convention as intentional rather than converging on the
   template.
4. Consider whether a total count is worth adding. No current UI shows "page 3 of N", and
   a `COUNT(*)` over `tg_posts` is not free — probably not, but decide it explicitly
   rather than by omission.

## Success criteria

- [ ] One implementation of the ordering + offset/limit logic, used by every paginated
      list endpoint.
- [ ] One declaration of the `limit`/`offset` query-parameter bounds.
- [ ] The existing pagination tests still pass unchanged — this is a refactor, not a
      behaviour change.
- [ ] A short note in the backend docs stating which convention `/data/*` uses and why it
      differs from `/items` and `/users`.

## Non-goals

- Not changing any endpoint's response shape or default page size as part of the refactor.
- Not migrating `/items` and `/users` off the template convention.
- Not adding cursor pagination. Offset paging is adequate at current page sizes; cursors
  are a separate decision, worth revisiting only if deep paging becomes a real access
  pattern.

## Open questions

- Where should the helper live — `app/services/pagination.py`, or alongside the existing
  serialization helpers?
- Several of these tables have a secondary sort key for stability (`tag_runs` and
  `translations` order by `(timestamp desc, id)`). Should the helper require an explicit
  tiebreaker rather than leaving determinism to each caller's discretion?

## References

- `docs/architecture-remediation-plan.md` — §11 T6.4, which names this as *why* the
  `stats.py` bulk-delete fix never reached `logs.py`
- `docs/frontend-backend-boundary-audit.md` §1 — the template-convention comparison
- `backend/app/services/logs.py::_list_logs_page` — the original of the copied pattern

## Session log

| Date | Notes |
|------|-------|
| 2026-07-21 | Filed while implementing Phase 2 of the architecture remediation plan, after writing the fourth copy of the pattern |
