# BYOK: bring your own AI key

Design settled 2026-09-08 across five rounds of grilling. The decisions live in
[ADR-016](./migration/ADR-016-bring-your-own-key.md) (who pays, the Provider surface, storage) and
[ADR-017](./migration/ADR-017-spend-session.md) (the third View-as tier). Vocabulary is in
`CONTEXT.md` under **AI access**. This file is the sequencing, not the argument.

## The rule everything follows

An Artifact is paid for by the Account that asked for it. Everything that is not an Artifact is
paid for by the deployment.

| Call | Key | Why |
|---|---|---|
| Summary, Chat, Tag run | AI Key | Artifacts, deliberately asked for |
| Corpus embeddings | Operator Key | `tg_post_embeddings` is `FOLLOW_SCOPED`, one shared vector per Post |
| Query embedding in `/rag/search` | Operator Key | Must match the corpus vector space |
| Translation batch | Operator Key | `run_translation_batch` has no Account; `tg_post_translations` is shared |

No fallback in either direction. An Account with no AI Key cannot create an Artifact.

## Sequencing

Each step lands on its own and leaves the suite green. Steps 1–4 are the feature; 5–6 are ADR-017
and can be deferred without blocking it.

**1. The table and its aggregate.** `tg_ai_credentials` modelled on `tg_bot_credentials`:
`user_id`, label, provider kind, base URL, `key_encrypted`, `last_validated`. Migration, an
`alembic/env.py` import, a `SCOPES` entry as `USER_OWNED`, a `tg_cleanup` inventory entry, an
`EXPORT_OMISSIONS` entry with its reason, and `services/ai_keys.py` as the sole writer declared as
an aggregate in `test_service_kinds.py`. Encryption reuses `core/secrets.py`; no second scheme.

**2. The second Provider.** `OpenAICompatibleProvider` against the existing `LLMProvider`
protocol, taking a base URL. `get_provider` currently caches instances in a module-level dict keyed
by name only (`app/ai/registry.py:5`), which would hand one Account another's client — key it by
credential or drop the cache. Ship with the guard that no auth header or key-bearing query
parameter can reach `full_request`.

**3. Threading the Key through the Artifact calls.** Eleven `get_provider` call sites across six
modules; the routes already have `current_user`. `SummaryRequest`, `ChatRequest` and `TagRequest`
gain the Key id. The 21 `settings.GEMINI_API_KEY` guards split into two distinct failures: no Key
at all, and a Key the Provider rejected. Regenerate the client.

**4. The unattended path.** `Summary.extra` gains `aiKeyId` beside `publishBotId`. Re-check it
against the Summary's owner **before** `decrypt_token` — ticket 33 is the reason, and the check
belongs in the same place. A rejected Key files a failed `LLMLog` row and clears the Key's
validation state; it does not disable the schedule.

**5. `LLMLog` grows three things.** `provider` and `base_url` as columns beside `model`,
denormalised, no foreign key. Plus `acted_by_user_id`/`acted_by_email`, the pair all four Artifact
families already carry, extending `test_view_as_elevation.py`'s existing guard to cover it.

**6. The spend tier.** A third `VIEW_AS_MODES` constant, `Permission.VIEW_AS_SPEND`, its own
ceiling validated strictly shorter than `VIEW_AS_ELEVATED_MAX_MINUTES`, and a derived inventory of
spendable operations. `/ai-keys` refused in all three tiers.

**Frontend, alongside 3 and 4.** A Keys panel in settings mirroring bot credentials. A Key
selector in the Action tab, with `scopedStorage` remembering the last used and no selector shown
when an Account has one Key. `GET /ai/models` proxies `{base_url}/models` per Key, cached, with
free text as the fallback. Deletes the hardcoded model list in `frontend/src/constants.ts:89` and
its backend twin.

## Guards this trips

Listed because each is a test that fails until answered, not a suggestion.

- `test_account_isolation.py` probes every mounted operation; each new route needs a probe or a typed excuse.
- `test_service_kinds.py` needs `services/ai_keys.py` to declare its kind.
- `test_admin_scoped_export.py` forces the new table into `export_sections` or `EXPORT_OMISSIONS`.
- `test_owner_backfill.py` derives its table list from `SCOPES`; a new `USER_OWNED` table appears there.
- `test_retention_split_four_ways.py` derives its inventories from `SCOPES`; AI Keys belong to neither, like `tg_quota_usage`.
- `test_view_as.py` walks every mutating operation against every tier.
- `test_route_module_hygiene.py` wants response models in `app/schemas/`, never inline.
- `test_log_list_payload_cost.py` is why `provider`/`base_url` are columns and not a blob.
- The pre-commit `generate-frontend-sdk` hook fails on a stale client.

Mutation-test each new guard before trusting it. Six false passes were caught that way during the
simplification programme, including one guard that could not fail at all.

## Deliberately not in scope

Per-Account embeddings, which would let an Account keep its Posts off the Operator's vendor and
multiply the largest table in the deployment. Reopen ADR-016 if privacy becomes the driver.

An AI spend ledger analogous to `tg_quota_usage`. `LLMLog.tokens` holds the data; no surface reads
it that way.

A first-party Anthropic Provider class. Reachable through any OpenAI-compatible gateway today.

Consent for spend sessions. If revisited, all three spendable resources move together — see
ADR-017's "Why not consent".
