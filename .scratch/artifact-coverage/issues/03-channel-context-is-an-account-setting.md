# AC-03: The Channel bio and tags prompt setting is an Account setting

**What to build:** the "include Channel bio" and "include Channel tags" prompt switches move
from browser storage (`UIContext`, `scopedStorage` keys `prompt_includeChannelBio` and
`prompt_includeChannelTags`) to a per-Account setting the server reads. The server builds the
Channels block of every prompt from that setting, so a Summary the scheduler regenerates gets
the same prompt as the same Summary generated or regenerated in the browser, with bios and
tags on or off. Spec: `.scratch/artifact-coverage/spec.md` (user story 4); decisions: ADR-038,
ADR-032 (one settings registry).

Found in the code review of AC-01 and AC-02: the browser sends `channelsText`, built by
`frontend/src/lib/channels/format-channels-for-prompt.ts`, and the scheduler never does, so
the two prompts differ whenever either switch is on.

**Blocked by:** AC-01, AC-02

**Status:** ready-for-agent

- [ ] Written first, and red before any other change: with bios and tags on, a scheduled regeneration and a browser regeneration of one predecessor build byte-identical prompts that carry the Channels' bios and tags (extend the AC-01 parity test)
- [ ] The two switches are one per-Account (`Home.USER`) key in `services/settings_registry.py`, read and written through the existing user-settings aggregate and the settings routes, defaulting to off
- [ ] The server formats the Channels block (the `format-channels-for-prompt.ts` layout, ported once) for the Summary, Chat and Tag prompts, reading the Account's setting; a Channel's tags are that Account's
- [ ] `channelsText` leaves the `/ai` request bodies, so `extra="forbid"` answers 422 for it; the browser stops building it, and `format-channels-for-prompt.ts` goes if nothing else uses it
- [ ] Generate builds its prompt on the server through `start_attempt`/`store_prompt`, as Retry and the scheduler do, so `store_prompt` writes `extra.missingPosts` on every path
- [ ] The settings UI (`ChannelGrid` and wherever else the switches render) reads and writes the Account setting; the two `scopedStorage` keys are no longer read or written
- [ ] Backend suite, backend lint, route guards, frontend unit tests, typecheck and lint pass; Playwright mocks follow the changed bodies
