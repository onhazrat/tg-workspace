# #155 📋 Ticket 21 is unblocked, and its five preconditions are one requirement

**State:** closed 2026-08-30 · **Branch:** `worktree-ticket-21-unblocked` into `main` · **Diff:** +96 / -15 across 2 files · **Opened:** 2026-08-29

---

**Supersedes #152**, rebased onto `258b7b9` now that ticket 35 has landed. Documentation only — no code, no tests, no migration. Close #152 in favour of this.

## Ticket 21 is unblocked

All ten of its declared blockers are done. Its line said `15, 16, 17, 18, 19, 20, 30, 32, 34 (done), 35`; it now says so plainly and marks the ticket as the front of the queue.

Ticket 34 and ticket 35 are marked done in the docs index, each with the sha and guard that closed it.

## The five preconditions are one requirement

Ticket 34 handed this ticket three, ticket 35 pinned two more **as tests** rather than leaving them to be found:

- **Ownerless setting groups** — a fresh install migrates before its first superuser exists, so ticket 34's backfill could not adopt the three seeded global presets and deliberately left them.
- **Ownerless `SyncJob` rows** — the scheduler still creates them with no owner, so `activeSyncJob` reports nothing for an auto-sync once the flag flips.

All five reduce to one sentence: **eliminate the `user_id=None` creation paths before flipping the flag.** Ticket 34 settled the rows that existed and the columns stayed nullable, so the paths that produced them are still producing them.

Ticket 21's checkboxes describe a flag flip and an isolation proof. They do not name that work, and it is the larger half — so the note says to expect rewriting the checkbox list before starting, and lists the paths the five notes have gathered so far (`ensure_default_group`'s optional owner, every log `upsert_*`, scheduler `SyncJob` creation).

## One checkbox ticked with a correction

Ticket 35's last checkbox asked that *"the flag-off responses are byte-identical to today's"*. They are not: `list_setting_groups` now returns **unfiltered**, decided with the user before implementing, because its old `me OR NULL` filter narrowed in both flag states. Recording that as met would have hidden the second such decision in the programme — and the first where the *old* code was the violation rather than the new one.

It also records what ticket 35 closed beyond its scope: four by-id writes with no owner check at all, including three behind plain `CurrentUser` routes.

## Verified before recording

PR #154 merged as `258b7b9`, signature valid, head of `main`. Deploy run `33269561719` succeeded for that exact sha. On main: `scoped_select` ×7 in `channel_setting_groups.py`, `_job_is_visible_to` ×3 in `scraper_jobs.py`, `may_act_on` ×2 in `data_import_export.py`, and the two old helpers gone from `app/` apart from one docstring line naming what replaced them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015sT3u1i9aTtYfkfxHkuE2o



## Comments

### onhazrat on 2026-08-30

Superseded by #156, which rewrites this ticket's checkbox list from a fresh audit and preserves the notes here verbatim. Ticket 21 shipped as four PRs: #156, #157, #158 and the flag flip to come.
