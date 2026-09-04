# #96 🔥 E: delete the legacy /api/* router, keep `items` on purpose

**State:** merged 2026-08-02 · **Branch:** `e-template-residue` into `main` · **Diff:** +156 / -290 across 11 files · **Opened:** 2026-08-02

---

Workstream E asked one question — "delete the template leftovers" — and the answer turned out to be **different for each of the three**. Surveying them before acting is what separated them.

## E2 — `routes/legacy.py` deleted ✅

It re-exported eleven pre-versioning aliases (`/api/publish`, `/api/bot-info`, `/api/tor-status`, …), each a call-through to its `/api/v1` handler with a `Deprecation` header, mounted only when `ENVIRONMENT != "production"`.

Two facts made this safe rather than merely tidy:

- **The frontend calls zero non-v1 paths** — `grep -rn '"/api/[^v]' frontend/src` returns nothing.
- **Production already answered 410** for them, via the middleware in `main.py`.

So the aliases served no live client in any environment that matters. Confirmed with the operator that nothing outside the repo calls them either.

**Three smoke tests were the last in-repo callers** — `test_proxy_health`, `test_tor_status`, `test_scrape_invalid_url` hit the unversioned paths directly, which my grep for `legacy` missed and the new version-boundary test caught. They now use the `/api/v1` paths they were always meant to.

**The 410 middleware stays.** With the router gone those paths are unrouted and a 404 would be truthful, but 410 Gone says *this existed and was withdrawn* — the more useful answer for a caller still holding old URLs, and it keeps the version boundary declared in one place.

`test_legacy.py` → `test_api_version_boundary.py`. The two pass-through tests went with the routes; what replaces them pins the boundary:

- all eleven aliases 404 in **every** environment — a 401 would mean the router came back
- production still 410s
- the 410 does **not** swallow `/api/v1`, which is a prefix of `/api/`

## E1 — `items` kept, deliberately ❌ won't-do

**`items` is the only owner-scoped resource in the codebase.** Every route in `routes/items.py` does `if not current_user.is_superuser and item.owner_id != current_user.id`, and `User.items` is the only `cascade_delete` relationship in `models.py`.

CLAUDE.md records the current position — *"one superuser owns all data — no per-user row scoping yet"* — and the multi-user roadmap says that is changing. So the template residue is also the **working reference implementation of the exact pattern the multi-user work needs**: read filtered by owner, write stamped with owner, superuser bypass, cascade on user delete.

Deleting it would have cost 293 LOC of backend, six model classes, a frontend module and a route — and then the multi-user work would re-derive the same seven `owner_id` checks from the upstream template. The audit's own keep-it argument (upstream re-sync fidelity) *is* dead, since workstream F deliberately diverges from the template's client config. **This is a different argument, and it survives.**

Accepted cost: a `/items` demo route and sidebar entry stay visible, and `tests/items.spec.ts` remains one of the three known-failing Playwright specs.

**Revisit when** multi-user row scoping lands on the domain tables — `items` has served its purpose then and goes in the same change. Recorded in the plan as a decision, not a leftover.

## E3 — `_template_tmp/` was already gone ✅

Not on disk, zero tracked files, and gitignored. The only residue was the `.gitignore` line. The backlog item outlived the thing it described.

## One piece of drift folded in

The pre-commit hook's SDK regeneration surfaced a single stale line: `usersDeleteUserMe` was committed with `responseStyle: 'fields'` while every other operation had `'data'` — a stray edit left behind by F1b's mutation testing. **Latent rather than live**, since its one caller (`DeleteConfirmation.tsx`) ignores the return value, but a committed client disagreeing with what the generator emits is exactly the drift F1b's config exists to end.

## Verification

- Backend **817 passed / 2 skipped** (`TEST_POSTGRES_DB=app_test_entropy`)
- mypy strict clean, ruff check + format clean, `ty` clean
- Frontend **819 pass / 0 fail**, `tsc -p tsconfig.build.json --noEmit` clean
- All pre-commit hooks pass, including SDK regeneration

No client regeneration was needed for the deletion itself — `generate-client.sh` already runs with `ENVIRONMENT=production`, so the legacy routes were never in the committed `openapi.json`.

---

**Workstream E is complete, and with it A, B, C, D, G, H and T. `F2` is the only unit left in the plan.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
