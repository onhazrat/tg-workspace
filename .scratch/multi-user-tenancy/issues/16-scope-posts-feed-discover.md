# 16: Scope Posts, feed, Discover (migrate 2)

**What to build:** Post reads, the feed, counts, and Discover draw only from Channels you Follow.

**Blocked by:** 03, 04

**Status:** done

- [x] Feed, lookup, counts, and Discover read through the scoping helper
- [x] Handle probes remain unscoped, deliberately and with the reason recorded
- [x] Both flag states are green

## Comments

**Delivered.** `list_feed`, `lookup_posts`, `count_posts_in_scope`
(`app/services/posts.py`) and `compute_discover_candidates`
(`app/services/discover.py`) each take a required keyword-only `user_id` and
build their Post query through `scoped_select(_, Post, user_id)` — a no-op
while `TENANCY_ENFORCED` is off, the `FOLLOW_SCOPED` EXISTS ticket 04 already
wrote once it flips. `user_id` has no default for the reason `scoped_select`
takes none: a defaulted `None` lets a call site forget the argument and still
compile, and the seam would then have to invent a meaning for "no user".

Two details are worth more than the wiring.

### The feed has two query shapes, and only one of them is obvious

Without a per-channel cap `list_feed` is a plain ordered select. With one it
wraps the base select in a `row_number()` subquery and re-aliases `Post` onto
it. The scoping predicate goes on `base`, **inside** the subquery — outside it
the window would rank rows the caller cannot see and the cap would then be
computed over the wrong set. `test_capped_feed_scopes_inside_the_window` is
that branch's own proof; the uncapped test passes either way.

### `followed` was four silently unscoped reads, not one

The feed's and the counts' `unfollowed_forwarded` filter, Discover's
`isFollowed` flag, and a saved report's live `isFollowed` all answer "do I
follow this handle?", and each did it with its own copy of
`select(Channel.name)` over the whole table. The fourth was found by review,
after this ticket's first cut had confidently written "three". Left alone,
Discover would report a candidate as already followed because *somebody else*
follows it — the wrong answer for this caller and a fact about another account
— and the `unfollowed_forwarded` view would quietly drop forwards from channels
the caller cannot see.

The four copies are now one function: `follows.visible_channel_names`. It is
named "visible" rather than "followed" because the two genuinely differ while
the flag is off, where it is still every Channel in the corpus. It also
lowercases once, at the source: `discover.normalize_handle` lowercases every
handle it extracts, and an un-lowercased name fails to match with no symptom
beyond a candidate you already follow being offered again.

### Handle probes: the checkbox, stated at the call site

`probe_map`, `list_probes` and `queue_counts` now read through
`unscoped_select(..., reason=PROBE_SCOPE_REASON)`. `DiscoverHandleProbe` was
already `Scope.CORPUS` in `tenancy.py`; what was missing is that the reads
themselves looked exactly like reads nobody had got to yet. `unscoped_select`
is a no-op by construction — its whole job is to make the call site greppable
and force the reason to be written — and the reason is one module constant
passed to both, so the two cannot drift into stating different reasons for the
same decision. `requeue_probes` is a write and is untouched.

### `create_report` lost its `user_id=None` default

It was already the owner stamp on the row; it now also picks the scope the
aggregation runs over, and "aggregate as nobody" has no honest answer — the
tempting one, resolving through `get_operator_user_id`, is the NULL fallback
the plan's decision 24 dissolves. The only production caller is a route holding
a `CurrentUser`. Test call sites pass `tests/utils/tenancy.ANY_READER`, a fixed
non-account uuid for tests that read through the seam but are not about it.

### Threading

`routes/data/posts.py` (3 routes), `routes/data/discover.py`
(`discover_candidates`), `services/prompt_assembly.py`, and `ai_routes.py`'s
`_resolve_posts_text` (6 call sites across summary/chat/tag). The AI path had
to take the same id into both of its reads: it sums `count_posts_in_scope` to
decide whether a selection fits in one prompt and then calls `list_feed` to
assemble it, so a count over a wider scope than the feed would 413 a selection
that would actually have fit. `test_counts_and_feed_agree_about_the_scope`
pins that.

### Deliberately not in this ticket

- **Dismissed candidates (`tg_discover_ignored`) are still global.**
  `DiscoverIgnoredChannel` is classified `USER_OWNED`, but its primary key is
  `handle` alone, so per-account dismissals need a composite-PK migration plus
  a backfill of the nullable `user_id` — the shape ticket 06 did for settings.
  Scoping only the *read* without that migration would actively break the
  feature rather than leave it as it is: `ignore_channels` skips a handle that
  already has a row, so once A dismisses `@foo`, B's dismissal writes nothing,
  and a scoped read would then tell B it is not dismissed. B could never
  dismiss it. Left global, with this note, and raised as **ticket 30**, which
  ticket 21 is now marked blocked by — under enforcement the visible symptom is
  one boolean, `isIgnored` reflecting everyone's dismissals rather than yours,
  and that is a reason not to flip the flag rather than a reason to hold the
  programme.
- **RAG vector search** (`routes/rag.py`) already restricts to
  `channel_names_for_operator`, the legacy `Channel.user_id == operator OR
  NULL` filter in `services/operator.py`. Converting that to the seam means
  changing a function the scheduler and sync paths also use; it belongs with
  ticket 22's `operator.py` cleanup, not with a Post read this ticket names.
- **Background jobs** (`jobs/retention.py`, `jobs/translation_batch.py`,
  `jobs/auto_summary.py`) read Posts with no caller to scope to. Retention is
  ticket 20.
- **Saved report reads** (`list_reports`, `get_report`) are ticket 17.

### Review round

A `/code-review high` pass found three issues, all fixed.

- **There was a fourth copy of `select(Channel.name)`, and it was the one that
  mattered.** `discover_reports.followed_names` runs *after* the aggregation:
  `create_report` scoped `compute_discover_candidates` and then handed the
  stored candidates to `report_to_camel`, which resolved `isFollowed` live from
  the whole `tg_channels` table and overwrote the scoped answer. Under
  enforcement `POST /discover/reports` and `POST /discover/candidates` would
  return different `isFollowed` for byte-identical input, with the report path
  leaking that another account follows the handle. Both the ticket text and the
  CLAUDE.md paragraph claimed three copies had been consolidated; they were
  wrong, because every test here stopped at the aggregate. `followed_names` now
  takes a required `user_id` and delegates to `visible_channel_names`;
  `report_to_camel` takes a required `viewer_id` with no default. A `None`
  owner is still answered corpus-wide, through `unscoped_select` with the
  reason written, because a report predating the stamp has no account to
  resolve against and inventing one is decision 24's NULL fallback.
- **`probe_map` was a third probe read and was left bare.** The first guard
  asserted `count("unscoped_select(") >= 2`, which a count satisfies without
  ever naming what it counted — so it passed while the read `report_to_camel`
  actually calls stayed indistinguishable from a forgotten one. The guard now
  parses the module and asserts *by function name* that `probe_map`,
  `list_probes` and `queue_counts` each contain an `unscoped_select` with a
  `reason=`.
- **The guard read a cwd-relative path.** `Path("app/services/...")` raises
  `FileNotFoundError` when pytest is invoked from the repo root instead of
  checking anything; it now derives from `__file__` like every other
  source-reading guard in the suite.

Both fixes were mutation-tested in turn: re-introducing the unscoped
`followed_names` fails the new `test_saving_a_report_keeps_the_scoped_is_followed`
with `{'t16-target': True} != {'t16-target': False}`, and un-marking
`probe_map` fails the tightened guard by name.

### Guards

`tests/services/test_post_tenancy_scoping.py`, 22 tests: both flag states for
each of the four reads, the capped-feed branch, two followers of one handle
both keeping their posts (the `FOLLOW_SCOPED`-not-`user_id` point), the two
`followed`-set behaviours, probes shared in both flag states, and a signature
guard asserting `user_id` is keyword-only with no default on all four.

Six mutations were applied and each was watched go red before the guards were
trusted: dropping `scoped_select` from the feed (3 tests fail), from lookup
(1), from counts (2), from Discover (1); unscoping `visible_channel_names` (2);
and flipping `TENANCY_ENFORCED` on, which correctly fails all four "unfiltered
while the flag is off" parity tests.

Full backend suite: 1401 passed, 2 skipped (pre-existing), 0 failed. `mypy` and
`ruff` clean. `ty check` reports 72 diagnostics, the 3 anchored in the new test
file being the fixture-return pattern `test_channel_tenancy_scoping.py` already
has. Generated OpenAPI is byte-identical to the committed one, so the frontend
and the generated client are untouched.
