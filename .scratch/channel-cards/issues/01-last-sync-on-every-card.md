# CARD-01: Last sync on every card, through a card that takes all its inputs as props

**What to build:** Every card size says when its Channel last synced and whether that is on
schedule, and the footer stops claiming "Pending" or "Up to date". A compact card shows its Last
sync as an age, coloured by the schedule rule, with the next sync under it. Cards and detailed
cards show "Synced 3h ago" in the same colour, the status only when the Channel is Restricted or
Frozen, and the next sync; a detailed card lists the Regular and the Dynamic schedule on a line
each. The Last sync chip in the card body goes. See `.scratch/channel-cards/spec.md`: user
stories 1 to 15, and the implementation decisions on the card face, what each size shows, the
status label, the Last sync colour, the schedule slots and the body chip.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Start with the prefactor the later tickets build on: the card face and the tile take everything
they read from app state as props (tag suggestions, whether the Channel is among the Scope's
selected Channels, the Channel filter setter), and the description of a card size gains whether
it is detailed, which stat tiles it shows and which keyboard letters it supports. Nothing visible
changes in that step. The prototype (`prototype/channel-cards`, `?variant=E`) shows the result;
note that its colour rule used fixed 1-day and 7-day ages, which the spec replaces.

- [ ] The card face and the tile render in a test with no router, no query client and no data context; the existing card tests pass unchanged apart from the behaviour this ticket changes
- [ ] The description of a card size says whether it is detailed, which stat tiles it shows and which keyboard letters it supports, and one test pins it for all four sizes
- [ ] One pure function decides the Last sync state from the Last sync, both schedules' on/off and next times, Frozen, Restricted and now: idle, never, late (an enabled schedule 24 hours or more past due), due (past due by less than 24 hours) or on-schedule
- [ ] Every card size that shows the Last sync carries its state as a data attribute, and the tests read that attribute, never colour classes; a test covers each of the five states and the 24-hour boundary on both sides
- [ ] A Restricted Channel keeps its red Restricted label and shows its age in grey
- [ ] A compact card shows the age and "next in …" for the earliest enabled schedule, with the exact Last sync and both schedules in its hover hint
- [ ] Cards and detailed cards show the status only for Restricted or Frozen; "Pending" and "Up to date" appear on no card face; the syncing overlay's progress percentage still works while this tab watches a sync
- [ ] A detailed card lists Regular and Dynamic with one of four states each: "in 3h", "due, 2h ago" in amber, "not scheduled", or "off" (even with an old time stored); Regular defaults to on and Dynamic to off
- [ ] Cards show the earliest enabled schedule as "next in …"
- [ ] The Last sync chip in the card body is gone; a test fails if it comes back
- [ ] Every new or changed test is mutation-checked
