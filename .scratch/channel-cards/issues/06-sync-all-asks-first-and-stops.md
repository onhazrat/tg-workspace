# CARD-06: Sync All asks first, and running syncs can be stopped

**What to build:** Sync all no longer starts on one click, and a Sync All or a Sync selected that
is running can be stopped. See `.scratch/channel-cards/spec.md`: user stories 68 to 74, and the
implementation decisions on Sync All's confirmation and Stop sync.

**Blocked by:** None (can start immediately)

**Status:** done

The cancel endpoint already exists and already cancels the Channels still queued as well as the
one in progress, across the API and worker processes, so this ticket is frontend only. The
prototype (`prototype/channel-cards`, `?variant=E`) shows the dialog and the Stop button for
Sync All.

- [ ] Clicking Sync all opens a confirmation dialog like the grid's other confirmations, saying how many Channels it will sync and how many it skips as frozen or excluded from Sync All; nothing is sent until it is confirmed
- [ ] One function produces that count and text, using the same eligibility rule the sync uses, with a test that its count matches what the sync would send
- [ ] The command palette's Sync All asks the same question through the palette's existing confirmation, with a test
- [ ] While a Sync All job runs, the Sync all button becomes Stop sync; while a Sync selected job runs, Sync selected's button does the same
- [ ] Stop sync cancels that exact job through the existing endpoint and shows a message saying the sync stopped; the button returns once the job settles
- [ ] A single Channel's Sync button is unchanged and has no stop
- [ ] The sync hook's test, with spies on the API object, covers holding the job id for Sync All and Sync selected only, and stopping the right job
- [ ] The end-to-end and UI primitive specs that click Sync All confirm first, and the Channels end-to-end spec confirms a Sync All, stops it and sees the job end as cancelled
- [ ] Every new or changed test is mutation-checked

## Comments

Merged into `t3code/implement-channel-card-spec` in 7974d9ac, on top of CARD-01. No conflicts; the CARD-06 e2e only clicks the toolbar Sync all, which compact cards keep, so it needs no `showCards()`. Verified as for CARD-01.
