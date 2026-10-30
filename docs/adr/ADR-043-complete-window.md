# ADR-043: An action runs on a Complete window or records why not

**Status:** Accepted (2026-10-29). Decided in a grilling session; amended on
2026-10-30 after prototyping it (variant D) and grilling the prototype. Spec:
`.scratch/complete-window/spec.md`.

## Context

Generate and Chat sync the selected Channels whose Last sync is older than
`min(End, now) - 60s`, and go ahead whatever the sync answers. The scheduler's
successor syncs stale Channels the same way, but skips the sync entirely while
any other sync job is running on the deployment, never reads its outcome, and
leaves frozen Channels out without saying so. Nothing records any of this, so
a Summary written from a window with missing Posts looks the same as one that
had them all.

Last sync is also the wrong test. It is when a sync finished, while the newest
page is read when it starts, so a sync in flight when the action starts can
finish after it and still miss the last seconds. A walk that stops at
`SCRAPER_ITERATION_LIMIT` counts as a success and moves Last sync while
leaving a hole nothing records. And nothing checks the window's Start: a
Channel followed yesterday, or a window older than the scrape cutoff, has a
recent Last sync and none of the Posts.

## Decision

An action freezes `now` when it starts. E is the earlier of the window's End
and that moment. A Channel in the Channel selection, the Hidden selection
included, is **Incomplete** unless all three hold:

1. **Head**: a sync read the Channel's newest page at or after E, or the
   workspace holds a Post of the Channel published after E.
2. **Start**: it holds a Post published at or before the window's Start, or a
   walk reached the Channel's first Post.
3. **Continuity**: every post id between that Post and the head is held or a
   confirmed gap.

All three are read from data, so a Follow made yesterday, a capped walk and
another Follower's older sync need no special case. A window with no
Incomplete Channel is **Complete**.

The check runs once, when an Artifact's Scope freezes: creating a Summary, a
Chat, a Tag run or a Discovery report, and the scheduler opening a successor.
Every later prompt reads the same Covered Posts (ADR-038), so a Retry, a later
Chat turn or a pasted response never syncs again.

Before freezing, the action syncs every Incomplete Channel it can repair,
walking back to the Start when tests 2 or 3 fail, under a deadline of 5
minutes, while a person waits with progress and can continue early. A sync
already in flight is joined, never a reason to skip, but one that read its
head before E does not pass test 1, so another is queued behind it. A frozen
Channel, a window older than the scrape cutoff, and a Channel Telegram will not
serve publicly (private, deleted, restricted) are listed and never synced.

A manual action asks first, in a gate before every Action-tab button that
freezes a Scope. The gate lists the Incomplete Channels grouped by whether a
sync can fix them, and every control does one visible thing:

- Enter syncs and continues. Untouched, the gate does the same by itself after
  30 seconds, so a person who walks away gets a synced window, not a stalled
  dialog. Any edit in the gate stops that countdown; after an edit only a
  click acts.
- Continue without syncing records the fixable Channels as skipped.
- Continue with the Complete Channels only drops the Incomplete ones from the
  Channel selection (with Undo). They are **Left out**: the Artifact names
  them, but they are not Incomplete Channels, and its window is Complete.
- Leave out, per row no sync can fix, does the same for one Channel.
- Unfreeze, on a frozen row, moves the Channel into the Account's default
  group and nothing else; the row moves among those a sync can fix, and the
  next Sync covers it.
- Cancel makes no Artifact.

When no Incomplete Channel can be fixed by a sync, the gate asks nothing and
the action runs, recording that. The gate always shows its review, whatever
the person did before the click.

An action never refuses to run on an Incomplete window. The Artifact freezes,
with its Scope, each Incomplete Channel, one reason, and its Last sync at the
time, its Left out Channels, and its **Unproven Posts**. Reasons are a closed
set: not synced to the end, hole in the window, history short of the Start,
before the retention cutoff, frozen, unavailable (Telegram will not serve it
publicly), sync failed, timed out, refused (Budget ceiling or disabled Request
kind), skipped. When several apply, the one a person can act on is shown:
skipped, failed, timed out, refused, then the rest. The record does not clear
when the Channel syncs later. A skip is one Account's choice for one Artifact
and touches nothing shared: not the Channel, its sync state or any failure
count.

A Channel whose only reason is not synced to the end, which a sync can fix and
whose scheduled sync is not yet past due, is **Behind**: routine lag the
scheduler will clear. Past due, it is **Overdue**. Both keep the reason; every
surface folds Behind Channels into one line ("last 18 h on 149") so they do not
hide the rest.

Unproven Posts says how much an Incomplete window may lack, which a Channel
count cannot: a hole's missing post ids exactly, and every other unproven
stretch at the Channel's own pace (Posts an hour over the week before its
newest page was last read). It is always written with "~", as a share of the
Posts the window holds, and is frozen with the Artifact so it does not drift.
Any Channel with no known pace makes it a floor ("~40+"); it says "no Posts
expected" only when every pace is known.

History marks an Artifact made on an Incomplete window with its Unproven
Posts ("~6 Posts unproven"), amber when a sync could have fixed some of it,
slate when none could. Its page shows the record, checks the same Channels and
window again now, and offers Regenerate when a sync could change the answer:
it restores the Artifact's Scope and runs the same action through the gate,
making a new Artifact, not a successor. The Action and Posts tabs show the same
check live for the current Scope. They never sync by themselves; a Sync there
is the person's own and shortens the action's sync without replacing it,
because for a window ending at the click its head read comes before E. A
scheduled successor still auto-publishes, adding one line to the metadata when
metadata is sent: its Unproven Posts and the Incomplete Channels that are not
Behind ("~40 Posts unproven (2%): @a, @b +3"), or nothing when only Behind
Channels remain. The prompt never mentions any of it. An Artifact made before
this record existed is not checked, which is not the same as Complete.

The kept-Partial-response state formerly called Incomplete is renamed **Cut
short**, so "incomplete" means only this. ADR-030's "Incomplete Summaries"
are Cut short ones.

## Considered options

- **Last sync at or after End.** Rejected for the three failures in Context:
  it trusts a sync's finish rather than its head read, and cannot see a hole
  or a short history.
- **Refuse, or hold, an action until the window is Complete.** Rejected: a
  Channel can stay Incomplete for good (frozen, private, past retention), and
  a scheduled Summary that waits forever is worse than one that says what it
  lacks.
- **Record a skip as a sync failure on the Channel.** Rejected: the Channel
  and its sync state are shared by every Follower, and one Account's skip says
  nothing about Telegram.
- **Tell the model in the prompt.** Rejected: a hedge buried in the prose is
  easy to miss, and a Retry would no longer send its original's prompt.
- **A checkbox per Channel in the modal.** Rejected: with 80 Channels it is a
  chore, and the Channel selection already decides which Channels are in.
- **A gate that waits for a click.** Rejected for the untouched case: a person
  who clicks Generate and walks away comes back to a dialog and no Summary.
  The countdown stops at the first edit, so it never acts on a list the person
  is still changing.
- **A grace period on test 1** (a head read up to 60 s before E passes), so a
  sync started before the click can stand in for the action's own. Rejected:
  E is the action's moment, and a rule with a margin is harder to reason
  about than one more sync.
- **The gate skipping its review after a sync started elsewhere**, and
  **Unfreeze that also syncs**. Rejected: minutes may pass between the two
  clicks, and a control whose effect depends on an earlier one is hard to
  reason about later. Each control does one visible thing.
- **Counting Incomplete Channels as the headline.** Rejected: six Channels
  can be three Posts or three hundred. The count stays in the breakdown.

## Consequences

- Each Channel gains the moment a sync last read its newest page, beside Last
  sync, which keeps meaning when a sync finished.
- Each Artifact's frozen Scope gains its Incomplete Channels.
- The scheduler's pre-sync loses its `has_active_sync_job` shortcut and must
  read what its sync achieved.
- Test 3 is only as good as confirmed gaps: an id Telegram never shows in a
  walk that saw both its neighbours stays unproven, and the Channel stays
  Incomplete until a walk confirms it. A confirmed gap must also clear when
  its Post is stored; on one deployment 2,955 of 36,013 confirmed gaps were ids
  already held, which inflates every hole count. That cleanup, with a backfill,
  lands before any surface shows hole counts.
- Each Artifact's record gains its Left out Channels and its Unproven Posts,
  and History's list carries only what its mark needs.
- The gate and the live check replace the pre-Summary and pre-Chat syncs; a
  Chat's later turns no longer sync.
