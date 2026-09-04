# #143 📋 File ticket 33: scope the auto-publish path

**State:** merged 2026-08-27 · **Branch:** `worktree-ticket-33-file` into `main` · **Diff:** +95 / -0 across 2 files · **Opened:** 2026-08-26

---

Files ticket 33 for a cross-account hole found by ticket 32's code review. Documentation only — no code, no tests, no migration.

## What it is

`jobs/auto_summary.py::_auto_publish` resolves `publishBotId` and `publishChatId` by primary key with no ownership check, and `services/publish.py::publish_summary_text` does the same for the credential before decrypting its token and sending. `upsert_summary` passes unknown body keys straight into `Summary.extra`, so an account can PUT its own summary naming another account's credential and destination, and the scheduler publishes as their bot.

Credential ids are client-chosen strings (`PUT /data/bot-credentials/{bot_id}` takes the id from the path), so they are guessable rather than random — and until ticket 32 the list endpoint handed every account's ids out directly.

## Verified before filing

Both call sites confirmed on `main`:

```python
# services/publish.py — no owner check
bot = session.get(BotCredential, credential_id)
if not bot:
    raise ValueError("Bot credential not found")
```

against the interactive path, which already has exactly the intended rule:

```python
# api/routes/telegram.py::_resolve_bot_token
if current_user is not None and bot.user_id is not None and bot.user_id != current_user.id:
    ...
```

So the scheduled path needs the same check keyed on the Summary's owner (`summary.user_id`, already in hand at the call site), not a new policy.

## Scope notes carried in the ticket

- The check belongs in `publish_summary_text`, not only in `_auto_publish` — guarding the caller leaves the next caller unguarded, which is what ticket 31 found after import alone was closed (nine other by-id writes).
- **Pre-existing.** Not introduced by ticket 32, and not closed by it: 32 scoped the two list reads, and this path never lists anything.
- **Does not gate ticket 21.** Enforcement neither causes nor fixes it, since neither `session.get` passes through `scoped_select`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
