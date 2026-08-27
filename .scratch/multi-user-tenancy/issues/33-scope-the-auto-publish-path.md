# 33: Scope the auto-publish path

**What to build:** The scheduler stops sending Telegram messages as another account's bot.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `_auto_publish` refuses a credential and a chat destination the Summary's owner does not own
- [x] `publish_summary_text` takes the acting owner and applies the check itself, so a second caller cannot skip it
- [x] A Summary naming a foreign `publishBotId` publishes nothing and says why in the publish log
- [x] Both flag states are green

## The hole

`jobs/auto_summary.py::_auto_publish` resolves both ids by primary key with no
ownership check:

```python
bot_id = str(extra.get("publishBotId"))
chat_dest_id = str(extra.get("publishChatId"))
dest = session.get(ChatDestination, chat_dest_id)
```

and `services/publish.py::publish_summary_text` does the same for the credential
before decrypting its token and sending:

```python
bot = session.get(BotCredential, credential_id)
if not bot:
    raise ValueError("Bot credential not found")
```

`upsert_summary` passes unknown body keys straight into `Summary.extra`, so
account B can `PUT` its own summary with `autoPublish`, `publishBotId` and
`publishChatId` naming account A's rows, and the scheduler will decrypt A's bot
token and send as A's bot, to a destination A chose.

Credential ids are **client-chosen strings** — `PUT /data/bot-credentials/{bot_id}`
takes the id from the path — so they are guessable rather than random, and until
ticket 32 the list endpoint handed every account's ids out directly.

Found by review during ticket 32. **Pre-existing; not introduced by 32**, and not
closed by it either: ticket 32 scoped the two *list* reads, and this path never
lists anything.

## The check already exists, one door over

`api/routes/telegram.py::_resolve_bot_token` implements exactly the intended rule
for the interactive path:

```python
bot = session.get(BotCredential, credential_id)
if not bot:
    raise HTTPException(status_code=404, detail="Bot credential not found")
if current_user is not None and bot.user_id is not None and bot.user_id != current_user.id:
    ...
```

So this is not a new policy to invent. It is the same rule applied to the
scheduled path, which has no `current_user` and must take the **Summary's owner**
instead — `summary.user_id` is already in hand at the `_auto_publish` call site.

## Put the check in `publish_summary_text`, not only in `_auto_publish`

Guarding the caller leaves the next caller unguarded, which is the shape of the
two auth gates that disagreed about `/password-recovery` for months, and of
ticket 31's finding that closing import alone left nine other by-id writes open.
`publish_summary_text` decrypts the token; it is the place that must be sure.

## Not the flag's business

Enforcement does not fix this and does not cause it. `scoped_select` narrows
statements that pass through it and neither `session.get` here does. Like ticket
31, this is a cross-account **write** — a send, and a token decryption — reached
by id, so it should close before the deployment has a second account that
matters, and it is not a reason to hold ticket 21.
