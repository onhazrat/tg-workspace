# #141 📋 File ticket 32: scope credentials and chat destinations

**State:** merged 2026-08-26 · **Branch:** `worktree-ticket-32-file` into `main` · **Diff:** +97 / -1 across 3 files · **Opened:** 2026-08-26

---

Files ticket 32 for the gap ticket 31's review reported: `list_bot_credentials` and `list_chat_destinations` are still unscoped reads, the last unscoped read family in `app/`.

Verified before filing. Both are a bare `select(Model)` with no `user_id` parameter at all:

```python
def list_bot_credentials(session: Session) -> list[dict[str, Any]]:
    return [bot_to_camel(b) for b in session.exec(select(BotCredential)).all()]
```

while every write on the same two families in `routes/data/credentials.py` already passes `user_id=_current_user.id`. So one family answers two different questions about whose rows these are depending on the verb. `tenancy.py` has classified both as `USER_OWNED` since ticket 03; only the call sites never adopted it.

It **blocks 21** rather than being fixed by it. `scoped_select` narrows a statement that goes through it, and these two never call it — so enforcement changes nothing here and both lists keep returning every account's rows afterwards, silently, since no test asserts otherwise today. A bot credential row carries a token: ticket 31 closed the write that let one account replace another's stored token, and this is the read half.

Ticket 21's `Blocked by` line updated to include 32.

Also adds ticket 31 to `docs/multi-user-tenancy-tickets.md`, which it was never added to — the index stopped at 30.

Documentation only. No code, no tests, no migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
