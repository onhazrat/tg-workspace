# ADR-040: An Operator can disable a Request kind

**Status:** Accepted (2026-10-28). Decided in a grilling session; no spec yet.

## Context

An Operator wants to switch whole kinds of Telegram work off on one deployment,
for example to run a deployment that never crawls the Directory. Three partial
switches already exist, and none of them answers this:

- **Job toggles** (`JOB_IDS`, `PUT /jobs/{id}`) stop a scheduled job's ticks.
  Turning off `discover_probe` stops the sweep from enqueuing handles, but the
  probes already on `discover_probe_background` keep draining, and
  `POST /jobs/discover_probe/trigger` ignores the flag. Work a person starts
  (one Channel's sync, a bulk follow, a handle check, a publish) has no job to
  toggle.
- **Lane pause** (`pausedLanes`) stops the consumer from reading a Queue lane,
  but the lane still accepts new work. It is a temporary hold.
- **Budgets and ceilings** limit one Account, not the deployment.

ADR-035 already sorts every Request into a kind at the one chokepoint,
`fetch_with_retry`, and the Requests tab reports load by kind.

## Decision

- **The unit is the Request kind**: auto, bulk, single, follow, probe, handle,
  botApi. `other` is a bug bucket and cannot be disabled. Directory crawling is
  `probe`. The harvest sweep only writes Directory rows behind a backlog
  ceiling, so it keeps running.
- **It is deployment policy**, a key in `tg_app_settings` with an `.env`
  default. An Operator changes it at runtime under the permission that already
  gates the Jobs routes. Settings holds the switches, and the Requests tab marks
  a disabled kind.
- **Refused in two places.** Each entry point (a route, an enqueue, a scheduler
  tick) refuses new work of a disabled kind with one fixed message, and the UI
  hides or greys out the action from the runtime config. `fetch_with_retry`
  refuses any attempt of a disabled kind before it leaves, so "nothing of that
  kind leaves" holds even on a path nobody gated. A refused attempt is not a
  Request and costs no Budget.
- **Disabling is lossless.** Work already queued stays on its lane: the consumer
  holds a lane that is paused **or** whose kind is disabled. A page walk refused
  mid-way puts its message back with no failure and no backoff, and resumes from
  its cursors when the kind is enabled again. A held job reports why it is
  waiting. Held work may wait indefinitely, as it can on a paused lane.
- **The switches are independent.** A bulk follow with `bulk` disabled still
  creates its follows and says their first sync was skipped. An auto-publish
  with `botApi` disabled still writes the Summary and files a failed publish log.

## Alternatives considered

- **Extend the job toggles.** Rejected: they cannot express work a person
  starts, and crawling would take two toggles to turn off.
- **Make disabling a kind write the lane pause.** Rejected: a paused lane takes
  new work and a disabled kind refuses it. Resuming a lane would then quietly
  re-enable a kind.
- **Drop queued work and finish the job as skipped.** Rejected in favour of a
  lossless hold, which matches lane pause and loses nothing a person asked for.

## Consequences

- Two switches overlap: the `auto_sync` and `discover_probe` job toggles and
  the `auto` and `probe` kinds. Once the kind switch is proven, delete the job
  toggles for kinds that have one.
- A sync that a refusal interrupts must be told apart from one that failed,
  because only a failure arms backoff and advances nothing.
