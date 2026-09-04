# #157 🗑️ Delete the single-operator helper, plan sync per account (ticket 21, PR 2)

**State:** merged 2026-08-30 · **Branch:** `ticket-21-delete-operator` into `main` · **Diff:** +885 / -483 across 40 files · **Opened:** 2026-08-29

---

Second of four for ticket 21. **Stacked on #156** — review that first; this PR's base is its branch.

## What goes away

`services/operator.py`, with its `Channel.user_id == operator OR NULL` filter and the local-dev fallback that quietly returned *every* channel when the operator had none.

## Auto-sync loops per account

Each owner's due set is computed from **its own follow's** setting group — the per-account column ticket 04 moved off the Channel precisely so a second follower wouldn't have to overwrite the first's settings to have any of their own. Reading the Channel's shared copy decides "is this due" from whichever account edited it last, which is the bug the follow table exists to prevent.

A Channel two accounts both follow is enqueued twice and scraped **once**: ticket 11's per-Channel claim coalesces the second onto the first, which reports its outcome and is not charged.

The partial-sweep cursor stays **global**, over the union of every owner's candidates. Per-owner cursors would split one piece of scheduler state into N that nothing reads back; only attribution is per owner.

## The other two scheduler jobs, from opposite ends

- **`run_auto_summary`** regenerates each due Summary as *its own* owner. No operator anywhere.
- **`run_translation_batch`** goes deployment-wide, because `PostTranslation` is `FOLLOW_SCOPED` — a translation is corpus, produced once and served to every follower, so translating per account would pay a provider twice to store two identical rows. It still excludes channels nobody follows, since those are retention's queue.

## RAG takes follows, not the seam

`scoped_select`'s `Channel` branch is gated on the flag, so while enforcement is off it returns every Channel in the corpus — one account's semantic search would have read another's posts right up until PR 4 flipped it. Which channels you have is not a visibility question the flag may defer, so `channel_names_for_user` reads the follow table and answers the same in both states. Ticket 16 deferred this conversion here because `select_operator_channels` was shared with the scheduler; those callers are gone, which is what makes it safe.

## What survives, deliberately

`resolve_follow_owner` answers *which owner to stamp on a new FK-constrained row*, not *what an account may see* — a write-time question that outlives enforcement. The bootstrap lookup moves beside it so the rule and its fallback cannot drift. Four migrations document parity with it and hardcode the rule rather than importing, so the move does not reach them.

## An inversion, not a deletion

`tests/api/test_tenancy.py` asserted the second account's channel was **absent**; it now asserts it is synced, in its own owner's job. It needs two real accounts — a single-account database cannot tell the per-owner loop from the operator loop it replaced, which is the same wall ticket 33's wiring guard hit.

A second test covers the other direction: a Channel nobody follows is synced for nobody, since iterating `select(Channel)` would sync it with no owner to attribute the job to.

## Carries the review fixes for PR 1

`/code-review` at high effort found 8 issues on #156. The sharpest was mine:

**`create_followed_channel`'s narrowed owner was bypassed.** Auto-follow reaches it through `run_db`, whose signature is `Callable[..., T]` with `*args: Any` — mypy checks nothing across that boundary, so `None` still reached `ensure_default_group`, resolved to the `default-global` scope key, and auto-follow went on creating an unowned Channel *and* an unowned setting group. Reachable in practice: a message enqueued before the deploy carries `"userId": null` across the upgrade.

That trap then caught me a second time — my first fix passed `resolve_follow_owner` straight to `run_db`, which does not inject a Session. It now has a wrapper that opens its own, like every other helper handed to `run_db`.

Also fixed:
- `SyncJobState.user_id` is required, so the narrowing reaches the statement that writes the column rather than stopping at `create_job`'s signature. `_persist_job` raises instead of writing NULL.
- A refused freeze still writes its sync log. The early `return` left a chat-id collision neither frozen nor recorded — the silent-refusal mistake `_auto_publish` documents at length.
- The PR 1 guard keyed exemptions on `path.stem`, and three stems exist twice here (`summaries`, `channels`, `logs`), so an exemption written for a service silently excused a route module. Now keyed on the path relative to `app/`.
- One guard assertion grepped module source twenty lines below a docstring rejecting exactly that; it now calls `run_auto_summary` for real.

## Verification

- full suite green: **1915 passed, 2 skipped**
- `mypy`, `ty`, `ruff` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TuidU3wGEmjiXqtNi9a9Kv
