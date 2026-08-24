# 03: Tenancy seam behind a disabled flag (expand)

**What to build:** No user-visible change. The scoping helpers exist, are classified and registered, and generate queries identical to today's while enforcement is off, so later tickets can adopt them one batch at a time without changing behaviour.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] A scoping helper, an ownership assertion, and the model classification exist
- [x] The module is a pure transform: it builds queries and compares identifiers, executes nothing
- [x] It is registered in the service-kind inventory, so acquiring database access later fails the suite
- [x] The enforcement flag is read in exactly one function, asserted by a guard
- [x] With enforcement off, generated queries are unchanged and the whole suite is green

## Comments

Landed. `app/services/tenancy.py` is a pure transform registered in the
service-kind inventory, guarded by `tests/services/test_tenancy_seam.py`
(44 tests). Full backend suite: 1200 passed, 2 skipped.

**One branch is deliberately unfinished.** `tg_channel_follows` arrives in
ticket 04, so a follow-scoped model asked to scope raises `NotImplementedError`
naming that ticket. The two alternatives were both worse: returning the
unscoped statement leaks another account's corpus the moment the flag flips,
and returning an empty one is a silent outage. Raising makes an early flip a
crash on the first query. `FOLLOW_KEYS` records the join column each
follow-scoped model needs (`Channel.id` is the handle; everything else repeats
it as `channel_name`), so ticket 04 writes the `EXISTS` and deletes the raise.

**What the classification cost.** The 18/7 split fell out exactly as the plan's
decision 1 predicted, so nothing there was a surprise. The one real finding was
in the guard, not the code: `User` and `Item` descend from `UserBase`/`ItemBase`,
so a single level of `SQLModel.__subclasses__()` misses precisely the two
template tables — the classification guard would have passed while being blind
to them. Caught by mutation-testing it (drop `User` from `OUT_OF_SCOPE`,
watch it fail), which is the seventh false pass that technique has caught here.

Fifteen mutations were run and each watched go red: dropped `SyncJob` from
`SCOPES`; scoped regardless of the flag; 403 instead of 404; a second module
reading `TENANCY_ENFORCED`; a `Session` parameter; an executed query;
unregistered from the kind inventory; the follow branch returning everything;
`Post` reclassified as corpus; an exemption with no reason; a default for
`detail`; a default for `reason`; a keyword-only `Session` on an `async def`;
a table in a fourth `app/models*.py`; an audit script reading the flag.

## Review findings, and what changed

`/code-review high` found six issues; all six are fixed here.

The one that mattered: **`assert_owner` was reopening the oracle it closes.**
It raised a generic `404 "Not found"`, but every 404 in this codebase names its
resource — `"Summary not found"`, `"Channel not found"`,
`f"{log_type} log not found"`. The moment a route adopted it, "someone else
owns this" and "this does not exist" would have been distinguishable by reading
the body, so the leak would have moved from the status line to the payload
rather than being closed. `detail` is now a required keyword argument with no
default, because a default is the trap.

Three were guard holes, all the same shape — a guard checking one spelling of
the thing it forbids. The `Session` check walked only `FunctionDef.args.args`,
so a keyword-only `Session` on an `async def` passed it. `_table_models()`
named three model modules instead of finding them, so a table in the fourth
module CLAUDE.md anticipates would have been invisible — the same false pass
the recursion fix closed, one level up. And the flag scan covered `app/` but
not `scripts/`, where the plan puts `audit_tenancy_drift.py`.

The remaining two: the flag's description in `config.py` and `.env.example`
said flipping it early "hides rows", when it actually raises and answers 500 —
"hidden rows" reads as a reversible degradation, and this is not one. And the
seam had no way to say "this read crosses accounts on purpose", which decision
6 (Admin export for all users) and `routes/data/admin.py` both need;
`unscoped_select(statement, reason=...)` is a no-op by construction whose only
job is to make that call site greppable and force the reason into writing.
