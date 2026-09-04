# #63 ✅ B2: declare response models for the channels family

**State:** merged 2026-07-31 · **Branch:** `b2-response-models-channels` into `main` · **Diff:** +1332 / -131 across 7 files · **Opened:** 2026-07-31

---

Unit `B2` from `docs/architecture-simplification-plan.md` — second family under the pattern `B1` established.

**Typed responses: 30/129 → 40/129.** Every channel-family endpoint is now typed except the SSE `bulk-follow/{id}/events` stream, which cannot be.

## What

`app/schemas/channels.py`:

| Model | For |
|---|---|
| `ChannelResponse` | `GET /channels`, `PUT /channels/{id}` |
| `ChannelStatsResponse` | `GET /channels/{id}/stats` |
| `ChannelUpsertRequest` | `PUT /channels/{id}` body |
| `SyncMetaEntry` | `GET /sync-meta` |
| `BulkReresolveStartIdsResponse`, `BulkResetSyncResponse`, `BulkUpdatedResponse`, `BulkSettingGroupResponse`, `BulkChannelTagsResponse` | the five bulk operations |

## The rule got sharper here

`ChannelResponse` is **open** (`extra="allow"`) because `channel_to_camel` merges in group-inherited settings and an optional `stats` block — both conditional, so declaring them would emit explicit `null`s where keys are absent today.

But the five **bulk** responses are built from dataclasses and literal dicts, so they're declared **closed**. `ChannelStatsResponse` likewise — at `GET /channels/{id}/stats` it *is* the whole response and every field is always present.

**Passthrough is for payloads that genuinely are open, not a default to reach for.**

## Wire compatibility is covered by tests, not assumed

These are the checks worth repeating for each remaining family:

- `test_stats_logs.py:296` asserts `row["stats"]["count"]` under `includeStats=true` → the optional `stats` block still passes through
- `test_setting_groups.py:276`, `test_bulk_sync_settings.py:54` assert `row["regularSyncEnabled"]` / `row["autoSyncIntervalMinutes"]` on channel rows → group-inherited fields still pass through
- `test_setting_groups.py:232` asserts `PUT` with a group-inherited field still returns **400**

That last one matters most. **A strict request model would have turned service-level rejections into 422s and changed the API's error contract.** `ChannelUpsertRequest` is deliberately permissive for exactly that reason — `upsert_channel` already normalises camelCase, rejects server-managed fields, and writes only recognised columns, so validation belongs there rather than in the schema.

## Verification

| Check | Result |
|---|---|
| backend suite | **733 passed / 1 skipped** |
| mypy strict | clean, 107 files |
| ruff check / format | clean |
| frontend suite | **686 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean against regenerated client |

Suite run serially, per the rule added in #62.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
