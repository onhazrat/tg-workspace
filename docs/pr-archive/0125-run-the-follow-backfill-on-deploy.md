# #125 🔧 Run the follow backfill on deploy

**State:** merged 2026-08-24 · **Branch:** `ticket-04-auto-backfill` into `main` · **Diff:** +178 / -6 across 3 files · **Opened:** 2026-08-24

---

Follow-up to #124. Makes ticket 04's backfill run unattended from `prestart.sh`, so staging (and production) fill `tg_channel_follows` on deploy instead of waiting for someone to SSH in.

## Why the original objection was wrong

I left it manual because the script exits 1 without a first superuser and `set -e` would take the deploy with it. But `initial_data.py`, which *creates* that superuser, is the last thing `prestart.sh` runs — so putting the backfill after it removes the problem entirely. The precedent was already three lines up: `backfill_chat_sessions.py` runs unattended on every deploy, and it deletes rows. This one only inserts.

## The hazard that is real

`--if-needed` reads a one-shot completion marker (a global `AppSetting` key), **not** "are there channels with no follow?".

That second question is correct today and becomes a data-loss bug at ticket 05. Unfollowing is *supposed* to leave a Channel with zero followers until retention collects it — so a deploy-time backfill asking it would silently hand the channel back to the operator who just removed it, on the next deploy, in the window before retention runs. A marker cannot develop that opinion, and it stays correct without anyone remembering to delete this line from `prestart.sh` when ticket 05 lands.

Two smaller ordering properties, both tested:

- The marker is written **only after every batch has committed**. Setting it first would turn a run interrupted halfway into a permanent skip, and the channels it never reached would stay unfollowed forever.
- A `--dry-run` never sets it, or a rehearsal would suppress the real run for good.

An explicit hand-run still ignores the marker — an operator asking for it means it.

## Verification

Three consecutive runs against seeded data, which is what three deploys look like:

```
=== deploy 1 ===  channels=5 follows_created=5 already_present=0 reassigned_to_operator=2
=== deploy 2 ===  follows backfill already completed; nothing to do
=== deploy 3 ===  follows backfill already completed; nothing to do
=== audit    ===  channels=5 follows=5 / channels_with_no_follow=0
```

Cost on every deploy after the first is one primary-key lookup.

Three mutations watched go red: mark before the walk finishes, swap the marker for the "is there work?" query, and set the marker on a dry run. Full suite **1253 passed, 2 skipped**; mypy, ty, ruff clean; `bash -n` on `prestart.sh`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
