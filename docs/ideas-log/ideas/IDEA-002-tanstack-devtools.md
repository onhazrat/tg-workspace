# IDEA-002: Add TanStack devtools (Router + Query)

| Field | Value |
|-------|-------|
| **Id** | IDEA-002 |
| **Status** | backlog |
| **Added** | 2026-06-17 |
| **Priority** | low |
| **Area** | frontend |

## Problem

Debugging TanStack Router navigation and React Query cache/state during local development is harder without the official devtools. Packages are already in `package.json`, and a minimal mount exists in `__root.tsx`, but integration may need polish (dev-only gating, summarizer route coverage, lazy loading, positioning).

## Proposed direction

- **Dev-only:** Render `TanStackRouterDevtools` and `ReactQueryDevtools` only when `import.meta.env.DEV` (or equivalent) so production bundles stay lean.
- **Lazy load:** Dynamic import devtools panels so they do not inflate the production chunk graph.
- **Placement:** Keep Router devtools `bottom-right`; avoid overlap with summarizer UI chrome and the Query panel toggle.
- **Coverage:** Ensure both `/_layout/*` and `/_tg/summarizer` trees benefit — today devtools mount at root; verify they work on summarizer routes and do not clash with full-screen TG layout.
- **Optional:** Document keyboard shortcuts / panel behavior in `development.md`.

## Success criteria

- [ ] Router and Query devtools available in local `bun run dev` on all main routes.
- [ ] Production build excludes devtools from the shipped bundle (or they are tree-shaken / never mounted).
- [ ] No visible devtools UI overlap with core summarizer controls.

## Non-goals

- Shipping devtools to production operators.
- Replacing browser React DevTools or custom in-app diagnostics.
- TanStack Table devtools (not in use for critical paths today).

## Open questions

- Mount at `__root.tsx` only vs. also inside `TgProviders` for summarizer-specific query client inspection?
- Default Query devtools open vs. closed (`initialIsOpen`)?

## References

- `frontend/package.json` — `@tanstack/react-query-devtools`, `@tanstack/react-router-devtools`
- `frontend/src/routes/__root.tsx` — current devtools mount
- `frontend/src/App.tsx`, `TgProviders` — summarizer shell

## Session log

| Date | Notes |
|------|-------|
| 2026-06-17 | Created |
