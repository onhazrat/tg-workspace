# 17: Scope Artifacts (migrate 3)

**What to build:** Summaries, Chats, Tag runs, and Discovery reports are private, in their own lists and in the unified History.

**Blocked by:** 03

**Status:** done

- [x] All four Artifact families and the unified History read through the scoping helper
- [x] Fetching another account's Artifact returns not-found, not forbidden
- [x] Both flag states are green

## Comments

**Delivered.** `list_summaries` / `list_chat_sessions` / `list_tag_runs` /
`list_reports` and `list_artifacts` build their query through
`scoped_select(_, Model, user_id)`; every by-id operation in the four families
calls `assert_owner` with the detail string that family already answers for an
absent row. All five take a required keyword-only `user_id`, threaded from
`CurrentUser` through `routes/data/summaries.py` (8 call sites),
`routes/data/chat_sessions.py` (4), `routes/data/discover.py` (4) and
`routes/data/artifacts.py` (1). The generated OpenAPI is byte-identical, so the
frontend and the generated client are untouched.

All four tables were already `Scope.USER_OWNED` in `tenancy.py` — an artifact is
something an account *produced* over a scope, not a copy of the corpus it read,
so none of them is follow-scoped. This ticket is the wiring, plus three things
that are not.

### Writes were in scope, and the ticket's checkboxes did not say so

The checkboxes name reads. But `upsert_summary` merges into whatever row its id
names, so a scoped read over a writable row lets a second account overwrite the
first's summary by guessing an id — and every read guard passes throughout. The
same holds for `delete_*` and for `update_report_flags`, the one write a report
accepts. All seven write paths now check the owner before touching the row; an
*absent* id still creates, which is what keeps an upsert an upsert.

Confirmed with the user before implementing rather than assumed.

### The History gave up its own hand-rolled owner filter

`/data/artifacts` was the one artifact list that already filtered by owner:
`owner == me OR owner IS NULL`, written pre-emptively when nothing else scoped
at all. Two owner filters with different NULL handling is exactly the drift
`tenancy.py` exists to prevent — it would surface as a summary visible in
History and absent from `/data/summaries`, or the reverse — so it now goes
through the seam like the four families it unions.

This is the one place in the ticket where behaviour changes **while the flag is
off**: History showed own+unowned rows and now shows every row, like its four
sources. That was put to the user as an explicit choice against keeping the
legacy predicate underneath, and consistency won: a single-operator deployment
has one account, so the two sets are the same rows today, and the alternative
leaves a fifth NULL-handling rule in the codebase for ticket 21 to reconcile.

The predicate is applied **per leg, not to the union**, because there is
nowhere else to put it: the union is wrapped in a subquery projecting the
labelled output columns, and `user_id` is not one of them. Adding it to the
projection so it could be filtered one layer up would ship every artifact's
owner to the caller in order to throw the rows away.

*(The first cut of this note claimed the reason was `?kind=` building a single
leg. Review pointed out that is wrong — a predicate on the union subquery would
apply whatever the leg count. `test_history_filtered_to_one_kind_is_scoped_too`
is still worth having, because the single-leg path is a second query shape.)*

### `report_to_camel(viewer_id=...)` lost its placeholder

Ticket 16 left `get_report` and `update_report_flags` passing
`viewer_id=report.user_id` with a comment saying it was a stand-in, because
neither had an authenticated viewer to pass. Both take one now, so both pass the
caller. `followed_names` lost its `user_id=None` branch with it — the branch
read the whole corpus through `unscoped_select` for an ownerless report, which
was the honest answer only while nobody could say who was asking.

The argument keeps the name `viewer_id` rather than collapsing into the owner,
even though the two coincide the moment reads are scoped. The day a report
becomes shareable they stop being the same question, and a call site that had
written `report.user_id` would answer the wrong one without changing.

### Guards

`tests/services/test_artifact_tenancy_scoping.py`, 58 tests. The battery is
parametrised over the four families as data rather than written out four times:
these are four near-copies of one module — `chat_sessions.py` says as much in
its own docstring — and the repo's rule is that a fix applied to one of a pair
is half a fix. `test_every_family_is_covered_by_this_battery` asserts the
family list against `ARTIFACT_KINDS`, so a fifth kind arrives with its scoping
or fails here.

Two guards exist to catch a scope that is too *tight* rather than too loose:
`test_your_own_row_is_still_reachable_under_enforcement` (a predicate matching
nothing passes every leak test) and
`test_a_genuinely_absent_row_answers_the_same_as_a_foreign_one`, which asserts
the two 404s against each other rather than against a literal — a family that
rewords its detail has to reword it in both places.

Seven mutations applied, all seven watched go red: the ownership check removed
from `get_summary`, from `upsert_tag_run` and from `delete_report`; the scope
dropped from `list_summaries`; the scope dropped from the History's tag leg
alone; a foreign chat row answering a generic `"Not found"`; and `list_artifacts`
accepting a defaulted `user_id` again.

Existing tests that read through these functions but are not about the seam pass
`tests.utils.tenancy.ANY_READER`, ticket 16's precedent — 51 call sites across
nine modules, plus 19 `user_id=None` owner stamps re-pointed at it.

### Review round

A `/code-review high` pass found four issues. Two were fixed here, one became a
ticket, one was a correction to prose.

- **The owner check collided with millisecond artifact ids.** `tg_summaries.id`
  and `tg_chat_sessions.id` are the *whole* primary key, and the frontend
  generated both from `Date.now().toString()` — a global namespace with
  millisecond resolution. That was survivable only while a create could
  silently merge into whatever row the id already named. Once this ticket
  scoped the upserts, two accounts saving in the same millisecond means the
  second one's **create** answers `404 Summary not found`, on a row its user
  has never seen, with nothing in the UI to retry. `AIContext.tsx` (3 sites)
  and `ChatContext.tsx` (1) now use `crypto.randomUUID()`, which is what
  `TagContext` already did and what server-side reports already are. Guarded in
  `architecture-invariants.test.ts` with a second test asserting the guard
  still matches something, and both mutations watched go red. Message ids
  inside a transcript keep their timestamps — they are array keys within one
  artifact, never a primary key.
- **`POST /data/import` still writes across accounts** — a bare
  `session.get(Model, id)` then overwrite, for summaries, bot credentials
  (which carry tokens) and chat destinations. It is the same "a scoped read
  over a writable row is half a fix" shape this ticket is built on, reaching
  the same tables by a different door, and the flag flip does not touch it.
  **Not fixed here**, deliberately: import is the other half of export, and the
  plan's decision 6 lets an Admin export *for all users*, so a restore that
  `assert_owner` refuses is not obviously wrong. Two coherent designs, one
  decision, its own ticket — **ticket 31**.
- **A guard that could not fail.** The first cut of
  `test_report_is_followed_answers_for_the_viewer_not_the_owner` asserted only
  that `user_id` was keyword-only with no default, which the signature guard
  already asserts over a superset of the same functions — reverting
  `get_report` to `viewer_id=report.user_id` left it green. It now monkeypatches
  `followed_names` and asserts which id reaches it, deliberately with the flag
  **off**, because that is the only state where viewer and owner can differ.
  The revert is now caught.
- **The per-leg reason above was wrong**, and is corrected in place.

### Deliberately not in this ticket

- **Background jobs.** `jobs/auto_summary.py` sweeps `select(Summary)` for
  auto-regenerate and `jobs/retention.py` prunes `tg_discover_reports`; neither
  has a caller to scope to, and retention is ticket 20.
- **Export.** `services/data_import_export.py` reads all four tables across
  accounts by design — ticket 28 makes export Admin-scoped. Its *write* half is
  **ticket 31**, raised by this ticket's review.
- **Dismissed candidates** are still global, unchanged from ticket 16's note.
  A report's `isIgnored` therefore still reflects everyone's dismissals; that
  is ticket 30, which ticket 21 is blocked by.
