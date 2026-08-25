# 15: Scope Channels and Follows (migrate 1)

**What to build:** With enforcement on, your Channel list shows only Channels you Follow. With it off, nothing changes.

**Blocked by:** 03, 04

**Status:** done

- [x] Channel list, bios, and stats read through the scoping helper
- [x] Per-Channel settings are read from the Follow, not the Channel
- [x] The payload shape is unchanged and the generated client stays valid
- [x] Both flag states are green

## Comments

**Delivered.** `list_channels`, `list_channel_bios`, `list_all_channel_stats`,
and `get_channel_stats` (`app/services/channels.py`) now build their query
through `scoped_select(_, Channel, user_id)` — a no-op while `TENANCY_ENFORCED`
is off, the real `FOLLOW_SCOPED` EXISTS ticket 04 already wrote once it flips.
`get_channel_stats` answers 404 for a channel the caller does not follow, same
`assert_owner` convention `unfollow_channel` uses. Routes thread
`user_id=current_user.id` through from `CurrentUser`.

`channel_to_camel` (`app/services/serialization.py`) takes an optional
`follow: ChannelFollow | None`. When given one, `tags`/`startId`/`startTime`/
`followedAt`/`discoveredVia` come from the Follow instead of the Channel —
`list_channels` passes the caller's own Follow, batch-loaded by the new
`follows_for_user`. A channel with no Follow row yet (pre-backfill) falls back
to the Channel's own values rather than turning up empty.

`setting_group_id` was deliberately left out of the read swap: it drives which
`ChannelSettingGroup` a row's inherited sync settings come from, and that
resolution has its own multi-writer surface in `channel_setting_groups.py`
(bulk assign, group merge/dedup) that this ticket does not touch. Ticket 22
still needs to pick that up when it drops the Channel's copies.

### The write side had to move too

`Channel` stays authoritative until ticket 22, so a write path that changes
these fields on an existing, already-followed Channel has to keep the acting
user's Follow current — otherwise the moment the read side switched to the
Follow, an edit would stop showing up until the Follow happened to get
touched some other way. `sync_follow_settings` (new, `app/services/follows.py`)
is that mirror: `ON CONFLICT DO UPDATE` against `MIRRORED_CHANNEL_FIELDS`,
next to the existing `ensure_follow`'s `DO NOTHING`. Three call sites needed
it: `upsert_channel` (`PUT /data/channels/{id}`), `bulk_update_channel_tags`,
and `_import_channels`'s edit branch — the last one was still calling the
additive `ensure_follow_for_channel`, which is a no-op against a Follow that
already exists, so a re-import of a changed, already-followed channel was
silently not reaching the Follow at all.

### Review round

A `/code-review` pass (5 parallel finders + verification) found five real
issues in the first cut. Two were fixed as the same underlying defect and are
the reason `sync_follow_settings` takes a `fields` parameter instead of always
mirroring everything:

- **The first version clobbered a diverged Follow on any edit.** It mirrored
  all six `MIRRORED_CHANNEL_FIELDS` unconditionally, so editing a field that
  isn't even mirrored (`bio`) would still overwrite the actor's own tags with
  whatever the Channel's shared copy currently held — erasing exactly the
  per-User divergence this ticket exists to make visible. `sync_follow_settings`
  now takes `fields`, the subset the caller's edit actually touched, and only
  that subset reaches the `ON CONFLICT DO UPDATE`'s `set_`. The insert side
  still uses every field — a brand-new Follow has no existing values to
  preserve. `bulk_update_channel_tags` passes `fields=["tags"]` for the same
  reason: it never touches start time/discovered-via and must not revert them.
- **`_import_channels`'s edit branch never synced at all** (see above) — now
  calls `sync_follow_settings` with the fields present in the imported item,
  matching the other two call sites.
- **Three independent enumerations of the same six field names** (`sync_follow_settings`,
  `ensure_follow_for_channel`, and `channel_to_camel`'s fallback ternaries), with
  a docstring claiming to be the one source of truth while visibly not being
  one. `MIRRORED_CHANNEL_FIELDS` (renamed from a module-private constant) is
  now shared by `ensure_follow_for_channel` and `sync_follow_settings` via a
  `_channel_field_values` helper; `channel_to_camel`'s per-key fallback stays
  hand-enumerated for readability (5 keys, each needing its own camelCase
  name), which the module docstring now says plainly rather than claiming
  otherwise.

One finding was evaluated and deliberately not changed: `bulk_update_channel_tags`
resolves the Follow owner and issues one upsert per channel inside its loop.
`resolve_follow_owner`'s `session.get(User, owner_id)` hits SQLAlchemy's
identity map after the first channel — no repeated round trip, so the
suspected N+1 isn't one. Batching the per-channel upserts into a single
multi-row `INSERT ... ON CONFLICT` is a real, separate optimization, but
nothing has measured this path as a bottleneck (unlike the channel list's
2.36s stats query or the photo-cache glob), so it is left as it is rather than
adding untested complexity against a guess.

### Guards

`tests/services/test_channel_creation_paths.py`'s `FOLLOW_WRITERS` gained
`sync_follow_settings` (a third real writer, not a rename) and its
`FOLLOW_TABLE_WRITERS` gained `app/services/serialization.py` — `channel_to_camel`
names `ChannelFollow` only in a type annotation, the same accepted false
positive the guard's own comment already argues for.

14 new tests in `tests/services/test_channel_tenancy_scoping.py`: visibility
scoping for all four read functions under `enforced`/unenforced, a follow
falling back to the Channel when absent, two followers of one handle seeing
their own tags, and the three write-side mirroring fixes above with explicit
regression tests (an unrelated `bio` edit must not touch a diverged Follow's
tags; a bulk tag update must not touch a Follow's start time; a re-import must
reach an existing Follow). Full backend suite: 1352 passed, 2 skipped
(pre-existing, unrelated), 0 failed. `mypy`, `ty check`, and `ruff` clean.

No OpenAPI/schema changes — `ChannelResponse`/`ChannelStatsResponse` are
unchanged, so the generated client needed no regeneration.
