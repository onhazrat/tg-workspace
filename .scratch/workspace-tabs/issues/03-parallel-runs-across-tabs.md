# TABS-03: Parallel runs across tabs (parked)

**What to build:** Nothing yet. This ticket records what it would take for two Artifact tabs of the
same kind to run at once, for example two Summaries generating side by side or two Chats streaming.
TABS-01 keeps one run per kind, and only the tab that owns the in-flight run shows its live stream.
Decided in the grilling session on 2026-09-29 (spec, Out of Scope).

**Blocked by:** TABS-01 (the tab identity it introduces is what per-tab state would be keyed on).

**Status:** needs-triage

## Effort estimate

Measured on 2026-09-29. Medium to large: four separate pieces of work of uneven size, about three
sessions in all, with Discover close to free.

Each run state today is a single global value in a React context, so a second run overwrites the
first:

- **Summary.** The AI context (about 640 lines) holds one streaming buffer (`summary`), and the UI
  context holds one `summarizing` flag. Both would become maps keyed by the run's Summary id. The
  Summary view already picks its body from "live stream first, saved text second", so it only needs
  to look up its own id.
- **Chat.** The chat context (about 460 lines) holds one transcript (`chatMessages`), one composer
  draft (`chatInput`), one `isChatting` flag and one mode. All four are per-conversation, so this
  is the largest piece: the context becomes a store keyed by chat session id, and the Chat view and
  its view model read their own entry. The race fixed in Action's `startChat` (a send reading the
  previous conversation's state) has to stay fixed per key.
- **Tag.** The tag context (about 455 lines) holds one `isGenerating`, one `isApplying`, one set of
  `suggestions` and one mode. Same change as Chat, smaller surface.
- **Discover.** Generate keeps no run state of its own and already pins the new report by id, so it
  likely needs only a check that nothing else blocks a second generate. Not verified.

What helps: all three contexts create a provisional Artifact row before they stream, so every run
has its Artifact id from the first byte. That id is the tab identity TABS-01 introduces, so the key
already exists.

What adds risk: nothing in these contexts can cancel a run (there is no abort signal anywhere), so
parallel runs also means deciding what happens to the Account's AI Key spend when several run at
once, and whether the backend's per-account limits need a look. Quota does not
apply here: it counts Telegram Requests, not AI calls.

## Comments
