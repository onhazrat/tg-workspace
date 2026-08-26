# 32: Scope credentials and chat destinations (migrate 6)

**What to build:** Your bot credentials and chat destinations are yours. The two list
endpoints stop returning every account's rows.

**Blocked by:** 03

**Blocks:** 21

**Status:** done

- [x] `list_bot_credentials` and `list_chat_destinations` read through `scoped_select`
- [x] Both take a `user_id` with no default, so a caller cannot omit it
- [x] A second account's credentials and destinations are absent from both lists
- [x] Both flag states are green

## Why this is its own ticket

Found by review during ticket 31, which closed the *writes* on these two families
and left the reads open.

**Correction, from the review of this ticket's own implementation:** it is *not*
"the last unscoped read family in `app/`", as this file originally claimed.
`list_setting_groups` hand-rolls `user_id == me OR user_id IS NULL` over
`ChannelSettingGroup`, `load_groups_by_id` reads that table unfiltered, and
`_running_job_from_row` reads `SyncJob` across accounts for
`GET /jobs/runtime-config`. All three are `USER_OWNED` and none is audited, so
**ticket 21 must not treat this ticket as an all-clear for `app/`**.

The shape is exactly what tickets 15 through 20 each did for one family, and the
classification is already there — `tenancy.py` has held
`BotCredential: Scope.USER_OWNED` and `ChatDestination: Scope.USER_OWNED` since
ticket 03. Only the call sites never adopted it:

```python
# backend/app/services/credentials.py
def list_bot_credentials(session: Session) -> list[dict[str, Any]]:
    return [bot_to_camel(b) for b in session.exec(select(BotCredential)).all()]

def list_chat_destinations(session: Session) -> list[dict[str, Any]]:
    return [chat_dest_to_camel(d) for d in session.exec(select(ChatDestination)).all()]
```

Both are a bare `select(Model)` with no `user_id` parameter at all, while every
write on the same two families in `routes/data/credentials.py` already passes
`user_id=_current_user.id`. So one family answers two different questions about
whose rows these are depending on the verb, which is the drift `tenancy.py`
exists to prevent.

## Why it blocks 21

Because the flip does not fix it. `scoped_select` narrows a statement that goes
through it; these two never call it, so enforcement changes nothing here and both
lists keep returning every account's rows afterwards — silently, since no test
asserts otherwise today.

A bot credential row carries a **token**. Ticket 31 closed the write that let one
account replace another's stored token; the read that lets one account list them
is the other half, and it is the half still open.

## Take the `user_id` as a required keyword

Ticket 16's rule, for its reason: all four of its scoped reads demand a `user_id`
with no default, so a call site that forgets one fails at the signature rather
than silently reading everybody's rows. Both functions here currently take
`(session)` alone — adding an *optional* owner would leave every existing caller
passing nothing and passing tests.

## Not in scope

The `migrate_bot_credentials` path and the `POST /data/import` importers for
these two families were closed by ticket 31 and are not this ticket's business.
