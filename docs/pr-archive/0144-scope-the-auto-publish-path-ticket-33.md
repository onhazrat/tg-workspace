# #144 🔒 Scope the auto-publish path (ticket 33)

**State:** merged 2026-08-27 · **Branch:** `worktree-ticket-33-scope-auto-publish` into `main` · **Diff:** +961 / -42 across 8 files · **Opened:** 2026-08-27

---

Closes ticket 33 (`.scratch/multi-user-tenancy/issues/33-scope-the-auto-publish-path.md`).

## The hole

`jobs/auto_summary.py::_auto_publish` resolved both ids by primary key with no ownership check, and `services/publish.py::publish_summary_text` did the same for the credential before decrypting its token:

```python
dest = session.get(ChatDestination, chat_dest_id)   # no owner check
bot = session.get(BotCredential, credential_id)     # no owner check
token = decrypt_token(bot.token_encrypted)
```

`upsert_summary` passes unknown body keys straight into `Summary.extra`, and credential ids are **client-chosen strings** taken from the path of `PUT /data/bot-credentials/{bot_id}` — guessable rather than random. So a Summary could name another account's `publishBotId` and `publishChatId`, and the scheduler would send as that account's bot to a destination it chose.

Found by review during ticket 32. Pre-existing, and not closed by 32 — that ticket scoped the two *list* reads, and this path never lists anything.

**Latent, not live, on the shipping config.** `run_auto_summary` still selects `Summary.user_id == operator OR IS NULL`, so a second account's Summary is not regenerated at all today. That filter goes away with the operator model, and this is a token decryption reached by a guessable id, so it closes now.

## What changed

- **`publish_summary_text` takes `acting_user_id` and applies the check itself** — a required keyword with no default, so no call site can quietly skip it (ticket 32's lesson). The check is here rather than only in the caller because this is what decrypts the token, and it refuses **before** `decrypt_token`: a refusal arriving after the plaintext exists has already produced the thing the encryption is for.
- **`_auto_publish` checks the destination**, which never reaches that service — only the `chat_id` string does — and passes `summary.user_id` as the acting owner, since there is no `current_user` out here.
- **A refusal writes a failed publish log** instead of returning quietly. An absent destination used to `return` after a `logger.warning` and write nothing, which made "auto-publish is misconfigured" and "auto-publish is off" the same observation for an unattended scheduler. Absent and foreign now answer alike, with the same text.
- **`may_act_on` in `tenancy.py`** is `assert_owner_on_write` without the raise, for these two callers that have no response to put a 404 in. `assert_owner_on_write` now delegates to it, so the rule is stated once — two spellings of "is this row mine" is the drift the seam exists to prevent, and they diverge on the NULL branch first.

## Decisions worth a second look

**Ungated in both flag states.** A send and a token decryption are writes by ticket 31's measure, and a flag that defers *visibility* has no business deferring them. Gated off, the scheduler goes on publishing as somebody else's bot until ticket 21.

**A NULL owner on either side** — the row's or the actor's — is permitted while the flag is off and refused under enforcement. The actor half is not hypothetical: `run_auto_summary` deliberately picks up ownerless Summaries. This is deliberately the opposite of what ticket 32 did to the credential *lists*: handing every account the deployment's stored credential is a leak, declining to use one is not. **It is another line on ticket 21's owner-backfill bill**, pinned in both directions so 21 finds a red test rather than an operator finding a publish that silently stopped.

## Verification

- Full backend suite: **1719 passed, 2 skipped**
- `mypy app` clean, `ruff check`/`format` clean, `ty` shows no new diagnostics
- **Mutation-tested, eight mutations, each watched going red.** One was watched *passing* and changed the work: attributing the send to `dest.user_id` instead of `summary.user_id` passed all nineteen tests, because every one gave the Summary and the destination the same owner — the wrong id and the right id were the same id. Only an ownerless destination separates them, and that row shape now carries the guard.

No route, schema, or client change — the pre-commit SDK generation is a no-op.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01AhiF4LryzLREW7bDeiwvHL
