# Request kinds: an Operator can disable one on a deployment

Status: ready-for-agent

Ticket prefix: `RKD`.

Settled by a grilling session and a UI prototype on 2026-10-28. **ADR-040** records the
decisions, and its Considered Options say why lane pause and the job toggles were not enough;
read it before changing what disabling means. The terms **Request**, **Request kind**,
**Budget**, **Lane**, **Queue lane** and **Operator** are in `GLOSSARY.md`; the Request kind
entry is new for this work. **ADR-035** is where Request kinds come from: every Request is
recorded with the kind of work that made it, at `fetch_with_retry`.

The prototype is variant C on the local branch `prototype/request-kinds` @ 1c513fcc (not
pushed). Its README holds the verdict and how to run it. Its switches only write an in-memory
store, so its data layer is not a model for the build.

## Problem Statement

An Operator has no way to stop a whole kind of Telegram work on their deployment. On staging,
Directory probes made 89% of all Requests over 30 days (about 2 million of 2.2 million), and the
only levers are partial. Turning off the probe sweep's job stops new handles being queued, but
the probes already on the probe lane keep draining, and the job's manual trigger ignores the
flag. Pausing a Queue lane holds what is on it but still accepts new work. Budgets and ceilings
limit one Account, never the deployment. Work a person starts (one Channel's sync, a bulk
follow, a handle check, a publish) has no switch at all.

So "this deployment never crawls the Directory" or "this deployment never talks to the Bot API"
cannot be said, and an Operator who wants it has to stop the worker or cut the proxies.

## Solution

Each Request kind except `other` gets an on/off switch on the deployment: auto sync, manual
bulk, manual single, follow, Directory probe, handle check and Bot API. The Operator flips them
in Settings, under Background jobs, in a "Telegram work" table that shows, per kind, the last 24
hours' Requests, their share, how many messages are queued now, and the switch. Disabling asks
first and says what it will stop and how much queued work it will hold.

Once a kind is disabled nothing of that kind leaves for Telegram. New work of that kind is
refused with one fixed message, and the UI greys out or hides the actions that would start it.
Work already queued is held, not dropped: it waits on its lane and runs when the kind is enabled
again, and a person watching a held sync is told why it is waiting. The Requests tab's "By kind
of work" table gets a Status column, so an Operator who sees a kind go to zero reads "Off since
10:32" there, with a link back to the switch.

## User Stories

1. As an Operator, I want to disable Directory probes on my deployment, so that it never crawls the Directory.
2. As an Operator, I want to disable auto sync, so that Channels stop updating on their own while I investigate a problem.
3. As an Operator, I want to disable manual single sync, so that nobody can sync one Channel by hand.
4. As an Operator, I want to disable manual bulk sync, so that nobody can run Sync all or Reset and sync.
5. As an Operator, I want to disable a bulk follow's handle checks, so that following in bulk sends nothing to Telegram.
6. As an Operator, I want to disable handle checks, so that adding a Channel by hand sends nothing to Telegram.
7. As an Operator, I want to disable the Bot API, so that the deployment never publishes or reads from a bot.
8. As an Operator, I want every Request kind except `other` to have a switch, so that I never need a second mechanism for a kind of work.
9. As an Operator, I want `other` to have no switch, so that a bug in attribution is not something I can hide.
10. As an Operator, I want each switch's default to come from `.env`, so that a new deployment can start with a kind disabled.
11. As an Operator, I want to change a switch at runtime, so that I can stop a misbehaving kind without a restart.
12. As an Operator, I want the switches to apply to the whole deployment, so that one change covers every Account.
13. As an Operator, I want only Accounts holding the Jobs permission to change a switch, so that the same people who run jobs control Telegram work.
14. As an Account without that permission, I want not to see the switches, so that Settings shows me only what I can use.
15. As an Operator, I want the switches in one table in Settings under Background jobs, so that I find them beside the jobs they relate to.
16. As an Operator, I want each kind's last 24 hours' Requests and share beside its switch, so that I see what disabling it would stop.
17. As an Operator, I want each kind's queued messages beside its switch, so that I see how much work disabling would hold.
18. As an Operator, I want disabling to ask me first and state its impact, so that I don't stop a kind by accident.
19. As an Operator, I want enabling to take one click with no question, so that undoing a disable is quick.
20. As an Operator, I want a disabled row to say since when it is off, so that I can tell how long the deployment has run without it.
21. As an Operator, I want the switch to look like every other on/off control in Settings, so that the page reads as one system.
22. As an Operator, I want a disabled kind's queued work to wait on its lane, so that nothing anybody asked for is lost.
23. As an Operator, I want held work to resume when I enable the kind again, so that I don't have to re-request it.
24. As an Operator, I want a sync that was mid-walk when I disabled its kind to go back on its lane and resume from where it was, so that disabling is lossless even for work in flight.
25. As an Operator, I want a sync stopped by a disable not to count as a failure, so that it arms no backoff and files no failed job.
26. As an Operator, I want a refused attempt not to be a Request, so that it costs no Budget and does not show on the Requests tab.
27. As an Operator, I want the refusal enforced where every Request leaves, so that a path someone forgot to gate still sends nothing.
28. As an Operator, I want a disabled kind kept separate from a paused lane, so that resuming a lane never re-enables a kind.
29. As an Operator, I want the switches independent of each other, so that disabling one never quietly disables another.
30. As an Operator, I want the scheduler to enqueue no auto sync while auto sync is disabled, so that no job rows pile up for work that will not run.
31. As an Operator, I want the probe sweep to enqueue nothing while probes are disabled, so that the probe lane does not grow.
32. As an Operator, I want the probe job's manual trigger to respect the switch too, so that "disabled" means disabled however the work was started.
33. As an Operator, I want the harvest sweep to keep running while probes are disabled, so that the Directory's queue still knows what to probe once I enable them.
34. As an Operator, I want the Requests tab to show a Status column in "By kind of work", so that I see which kinds are off where I read the load.
35. As an Operator, I want a disabled kind to keep its row on the Requests tab with zero Requests, so that it does not vanish exactly when it is off.
36. As an Operator, I want the Status column to link to the switch, so that I can change it from where I noticed it.
37. As an Operator, I want `other` to show no status, so that the column only speaks for kinds that can be disabled.
38. As an Account, I want the Sync button on a Channel greyed out with the reason when manual single is disabled, so that I know why it does nothing.
39. As an Account, I want Sync all and Reset and sync greyed out when manual bulk is disabled, so that I don't start work that is refused.
40. As an Account, I want a bulk follow refused before it checks a handle when follow is disabled, so that I learn at once.
41. As an Account, I want a bulk follow to still create my follows when manual bulk is disabled, and to tell me their first sync was skipped, so that I keep the follows and know they wait for auto sync.
42. As an Account, I want adding a Channel by handle refused with the reason when handle checks are disabled, so that I know it is the deployment's choice.
43. As an Account, I want Publish greyed out with the reason when the Bot API is disabled, so that I know why I can't publish.
44. As an Account, I want a refused request to answer with one fixed message naming the disabled kind, so that the reason is the same wherever I meet it.
45. As an Account watching a held bulk or single sync, I want its progress to say it is waiting because that kind is disabled, so that it does not look hung.
46. As an Account, I want a held sync's progress to move again on its own once the kind is enabled, so that I don't have to start it again.
47. As an Operator, I want an unattended auto-publish to still write the Summary and file a failed publish log naming the disabled Bot API, so that the schedule's failure is visible and the Summary is kept.
48. As an Operator, I want auto summaries to keep generating while the Bot API is disabled, so that disabling Telegram work does not stop AI work.
49. As an Operator, I want held work allowed to wait indefinitely, as it can on a paused lane, so that both holds behave the same.
50. As a developer, I want a guard that fails if a disabled kind can reach the network, so that the chokepoint cannot be bypassed quietly.

## Implementation Decisions

### What a switch is

- **Seven switches**, one per Request kind except `other`: `auto`, `bulk`, `single`, `follow`, `probe`, `handle`, `botApi`. The values are the stored `RequestKind` values, so they are a format.
- **Deployment policy.** The switches live in the deployment settings table (not per User), declared as Settings in the one settings registry (ADR-032) so search, links and `.env` defaults work as they do for every other Setting. Each has an `.env` default; every kind is enabled unless `.env` says otherwise. Their Setting ids sit in the Background jobs topic.
- **Who may change them:** whoever holds the Jobs manage Permission, the one that already gates the Jobs routes. No new Permission and no seeded-role migration.
- **Since when.** A disable stores the moment it was disabled, so Settings and the Requests tab can say "since". Enabling clears it.
- **One read for the whole backend.** A single function answers "is this kind enabled", read by every gate below. It reads the settings row fresh enough that a change takes effect within the consumer's existing pause re-check interval, not only at boot.

### Where it is refused

- **At the chokepoint.** `fetch_with_retry` refuses any attempt whose attribution names a disabled kind, before the attempt leaves and before any Lane permit or pacing wait. It raises a distinct "kind disabled" error rather than a network error, so no caller mistakes it for Telegram failing. A refused attempt is not a Request: it is not recorded, not charged and not retried. Work with no attribution (`other`) is never refused.
- **At each entry point**, so the person gets the message instead of a half-done job. The routes and paths that start work of each kind check the switch first and refuse with one fixed message:

  | Kind | Entry points | What a person meets |
  |---|---|---|
  | auto | the scheduler's auto-sync tick, checked before it creates a job | nothing: the tick enqueues nothing |
  | bulk | Sync all, Reset and sync, a bulk follow's first sync | Sync all and Reset and sync greyed out; a bulk follow still follows, unsynced |
  | single | Sync on one Channel | the Sync button greyed out |
  | follow | a bulk follow, before its first handle check | bulk follow refused |
  | probe | the probe sweep, scheduled and triggered | nothing: the sweep enqueues nothing |
  | handle | the handle-check routes (scrape, channel info, resolve start time) | adding a Channel by handle refused |
  | botApi | publish, bot info, bot files, auto-publish | Publish greyed out; auto-publish files a failed log |

  The table came from the prototype's copy, trimmed. The fixed message reads "`<kind label>` is disabled on this deployment" and is one shared constant; the HTTP status for a refusal is decided once and used by every route.
- **The UI learns the switches from the runtime config** the frontend already loads, and greys out or hides the actions above with the same message as a tooltip. The server refusal stays the authority; the UI only spares a round trip.

### Holding queued work

- **A lane is held when it is paused or its kind is disabled.** The consumer already re-reads the paused-lane set on an interval; it adds the lanes of disabled kinds to it: the three tiers of each of auto, bulk and single, and the probe lane. Lane pause is unchanged and stays its own setting.
- **A walk refused mid-way goes back on its lane.** When the chokepoint refuses a page inside a Channel's sync, the consumer returns the message to its lane instead of failing it: no failed Channel, no backoff, no terminal job, and `next_*_sync_at` untouched. It releases the Channel's sync claim. The walk resumes from the sync cursors when the kind is enabled again. A probe refused mid-way returns to the probe lane the same way.
- **A held job says why it waits.** A sync job whose messages sit on a held lane reports a waiting reason in its progress, over SSE and in the reconnect read, naming the disabled kind. When the kind is enabled the reason clears and progress resumes without anyone acting.
- **Held work has no lifetime.** It may wait indefinitely, as work on a paused lane already can. Sync-job retention still prunes only terminal jobs.

### Independence and the existing switches

- **No switch implies another.** A bulk follow with `bulk` disabled and `follow` enabled creates the follows, skips the first sync and says so in its response. An auto-publish with `botApi` disabled still writes the Summary and files a failed publish log naming the disabled kind; auto-summary generation is not gated.
- **The job toggles stay for now.** `auto_sync` and `discover_probe` keep their Jobs enabled flags. Either one off still stops its job; the kind switch is the stronger rule. ADR-040's Consequences plan their removal once the kind switches are proven; that removal is not this work.
- **Harvest is not gated.** The harvest sweep only writes Directory rows behind its backlog ceiling, so it runs while probes are disabled.

### Settings: the Telegram work panel

- A panel in the Background jobs topic, titled "Telegram work", visible with the Jobs manage Permission. It is a table: kind (swatch and label, and "off since HH:MM" under a disabled one), last 24h Requests, share, queued, enabled.
- The enabled column uses the On/Off pill the Settings rows already use for booleans (`BarToggle`), not the square switch. The user rejected the square switch in the prototype.
- Disabling opens the existing confirm dialog stating the kind's last 24h Requests, what stops (the "What a person meets" column above) and how many queued messages will be held, and quoting the refusal a person will read. Enabling applies at once.
- Last 24h Requests come from the existing Requests Breakdown; queued counts from the existing lanes read, summed per kind. Neither needs a new route.
- The seven Settings this panel shows are not rendered a second time as plain rows.

### Requests tab

- "By kind of work" gains a Status column: "On", or "Off since HH:MM" with a link to the panel. `other` shows a dash.
- A disabled kind with no Requests in the range is added as a zero row, so it stays visible. A disabled kind keeps its normal row when it has Requests.

## Testing Decisions

- **A good test drives the outside.** On the backend: flip a switch through the Operator settings API, make work happen against a fake Telegram, then read what the API and the lanes say. On the frontend: a person's clicks and what the page shows. No test reaches into the settings cache, the consumer's held set or a component's state.
- **Seam 1: the backend.** Telegram is faked at `network._fetch_once`, the seam the quota ledger and request-recording tests use. Everything above it is real: the sync routes, the scheduler tick, the probe sweep and its trigger, hand-drained lanes, the bulk follow, the handle-check and publish routes. Cases:
  - **The chokepoint:** for each switchable kind, a disabled kind makes no call to `_fetch_once`, records no Request and charges nothing; `other` is never refused; enabling it again lets the same work through.
  - **Entry points:** each row of the entry-point table refuses with the fixed message, and the auto tick and the probe sweep (scheduled and triggered) enqueue nothing and create no job.
  - **Holding:** messages queued before a disable stay on their lane through a drain, and run after the kind is enabled; a paused lane and a disabled kind hold independently, and resuming the lane does not release a disabled kind's work.
  - **In flight:** a sync refused mid-walk returns its message, files no failure, arms no backoff, leaves `next_*_sync_at` alone, releases its claim, and resumes from its cursors once enabled.
  - **Job progress:** a held job reports the waiting reason over SSE and the reconnect read, and clears it on enable.
  - **Independence:** a bulk follow with `bulk` disabled follows and skips the first sync; auto-publish with `botApi` disabled writes the Summary and files a failed publish log.
  - **Policy:** `.env` defaults apply to an empty store; a runtime change takes effect without a restart; an Account without Jobs manage cannot change a switch; the runtime config carries the switches.

  Prior art: the quota ledger tests (the `_fetch_once` seam), the lane-draining tests (hand-drained lanes and lane pause), the probe sweep tests, the request-recording tests (kind attribution), the quota ceiling tests (a refused Channel skipped, not failed).
- **Seam 2: the frontend.** One Playwright spec over a mocked API:
  - the Telegram work panel shows the seven kinds with Requests, share and queued; disabling asks and states the impact, enabling does not ask;
  - the Requests tab's Status column reads On and "Off since", links to the panel, and keeps a disabled kind with zero Requests as a row;
  - with a kind disabled in the runtime config, its actions are greyed out with the reason (Sync, Sync all, Reset and sync, add by handle, Publish);
  - an Account without Jobs manage sees no panel.

  Render tests for each new branching component, as the CRAP ratchet requires. Prior art: the Requests tab's spec and the Settings page's specs.
- **The guards each ticket will meet:** the route inventories (`bash scripts/route-guards.sh`) and permission checks; the settings declarations and table-split guards for the new keys; the request-recording guard (no known path records `other`); the frontend constants catalog. None is loosened.
- **A new guard:** every `RequestKind` except `other` is switchable, and the chokepoint refuses each one. Mutation-test it and every new test before trusting it, and name the mutation in the commit body (`Mutation-checked: ...`).

## Out of Scope

- Deleting the `auto_sync` and `discover_probe` job toggles. Planned by ADR-040 once the switches are proven.
- Splitting the Bot API switch into publishing and the rest.
- A per-Account switch. Budgets and ceilings already limit one Account.
- A lifetime for held work, or cancelling it on disable.
- Holding a publish to send later when the Bot API is enabled again.
- Gating the harvest sweep or the reference extraction, which make no Requests.
- Marking disabled periods on the Requests tab's trend charts.

## Further Notes

- The prototype's verdict is in its README: variant C, with `BarToggle`. From the other variants it keeps A and C's zero row for a disabled kind and B's quoted refusal in the confirm dialog.
- On staging the lanes read answered 500 for the probe lane until onhazrat/tg-workspace#235, so the panel's queued column depends on that fix being deployed.
- ADR-040 says why a disabled kind is not a paused lane: a paused lane still takes new work, and a disabled kind refuses it. Keep them two settings even though the consumer holds both.
