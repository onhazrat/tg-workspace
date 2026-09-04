# #134 🔒 Scope Artifacts (ticket 17)

**State:** merged 2026-08-25 · **Branch:** `worktree-ticket-17-scope-artifacts` into `main` · **Diff:** +1290 / -289 across 25 files · **Opened:** 2026-08-25

---

Closes ticket 17 (`.scratch/multi-user-tenancy/issues/17-scope-artifacts.md`).

With `TENANCY_ENFORCED` on, each of the four artifact families shows only the
caller's own rows, and every by-id operation on a foreign row answers **404 with
that family's own detail string** — not 403, which would confirm the row exists,
and not a generic `"Not found"`, which would move the same oracle into the body.
While the flag is off, `scoped_select` is a no-op and nothing changes, with one
deliberate exception noted below.

`list_summaries`, `list_chat_sessions`, `list_tag_runs`, `list_reports` and
`list_artifacts` build their query through `scoped_select`; `get_*`, `upsert_*`,
`delete_*` and `update_report_flags` call `assert_owner`. All five take a
required keyword-only `user_id`, threaded from `CurrentUser` through 17 route
call sites. **The generated OpenAPI is byte-identical**, so the frontend and the
generated client are untouched.

All four tables were already `USER_OWNED` in `tenancy.py` — an artifact is what
an account *produced* over a scope, not a copy of the corpus it read, so none of
them is follow-scoped. Three things here are not the wiring.

## Writes were in scope, and the ticket's checkboxes did not say so

`upsert_summary` merges into whatever row its id names, so a scoped read over a
writable row lets a second account overwrite the first's summary by guessing an
id — and every read guard passes throughout. Same for `delete_*` and for
`update_report_flags`, the one write a report accepts. An absent id still
creates, which is what keeps an upsert an upsert.

## The unified History gave up its own owner filter

`/data/artifacts` hand-rolled `owner == me OR owner IS NULL`, written
pre-emptively while nothing else scoped at all. Two owner filters with different
NULL handling is exactly the drift `tenancy.py` exists to prevent — it would
surface as a row visible in History and absent from `/data/summaries`.

**This is the one adoption that changes a response while the flag is off**:
History showed own+unowned and now shows every row, like its four sources. A
single-operator deployment has one account, so the two sets are the same rows
today, and the alternative leaves a fifth NULL-handling rule for ticket 21 to
reconcile.

The predicate goes on **each leg, not the union** — `?kind=` builds a single leg,
so a filter on the outside is skipped by exactly the request the History tabs
make. `test_history_filtered_to_one_kind_is_scoped_too` is parametrised over all
four kinds for that reason.

## `report_to_camel` lost its `viewer_id` placeholder

Ticket 16 passed `viewer_id=report.user_id` from `get_report` and
`update_report_flags` with a comment saying it was a stand-in, because neither
had an authenticated viewer. Both hold one now. `followed_names` lost its
`user_id=None` branch and its `unscoped_select` with it.

The argument keeps the name `viewer_id` rather than collapsing into the owner:
the day a report becomes shareable, "whose follows" and "whose report" stop
being the same question, and a call site spelling it `report.user_id` would
answer the wrong one without changing.

## Guards

`backend/tests/services/test_artifact_tenancy_scoping.py`, 58 tests. The battery
is parametrised over the four families **as data** rather than written out four
times — these are four near-copies of one module, and the repo's rule is that a
fix applied to one of a pair is half a fix. `test_every_family_is_covered_by_this_battery`
asserts the family list against `ARTIFACT_KINDS`, so a fifth kind arrives with
its scoping or fails here.

Two guards catch a scope that is too **tight** rather than too loose: a predicate
matching nothing would pass every leak test.

**Seven mutations applied, all seven watched go red** — the ownership check
removed from `get_summary`, `upsert_tag_run` and `delete_report`; the scope
dropped from `list_summaries`; the scope dropped from the History's tag leg
alone; a foreign chat row answering a generic `"Not found"`; and `list_artifacts`
accepting a defaulted `user_id` again.

Existing callers pass `tests.utils.tenancy.ANY_READER`, ticket 16's precedent —
51 call sites across nine modules, plus 19 owner stamps re-pointed at it. The
two hand-written `DiscoverReport` seeds were given owners so the payload/column
cost guards are already enforcement-clean when ticket 21 flips the flag.

## Verification

- Full backend suite: **1460 passed, 2 pre-existing skips**.
- Artifact suite with `TENANCY_ENFORCED=True`: **98 passed**. The off-state tests
  pin the flag with their own fixture rather than relying on the ambient default,
  so this file is green in both flag states and ticket 21 need not revisit it.
- `mypy app`, `ty check app`, `ruff check`, `ruff format --check`: clean.
- Generated OpenAPI diffed against `frontend/openapi.json`: identical.

## Deliberately not in this ticket

- **Background jobs** — `jobs/auto_summary.py` sweeps `select(Summary)` and
  `jobs/retention.py` prunes reports; neither has a caller to scope to, and
  retention is ticket 20.
- **Export** — `data_import_export.py` crosses accounts by design; ticket 28.
- **Dismissed candidates** are still global, unchanged from ticket 16's note.
  Ticket 30, which ticket 21 is blocked by.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ESn1yXfbJKMRANkzG2UfCa
