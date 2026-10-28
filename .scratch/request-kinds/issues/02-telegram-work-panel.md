# RKD-02: The Operator sees and flips the switches where they read the load

**What to build:** The switches from RKD-01 get the UI the prototype chose (variant C). In Settings, a "Telegram work" panel under Background jobs shows each kind's last 24 hours' Requests, share and queued messages beside an On/Off pill, asks before disabling and states the impact. The Requests tab's "By kind of work" table gets a Status column, and everyone meets disabled kinds as greyed-out actions instead of a failed request. Spec: "Settings: the Telegram work panel", "Requests tab", the UI line of "Where it is refused", and Seam 2 under "Testing Decisions". The prototype is variant C on the local branch `prototype/request-kinds` @ 1c513fcc; its README holds the verdict.

**Blocked by:** RKD-01

**Status:** ready-for-agent

- [ ] A "Telegram work" panel in the Background jobs topic, visible with the Jobs manage Permission: one row per switchable kind with swatch and label, "off since HH:MM" under a disabled one, last 24h Requests, share, queued and an enabled column.
- [ ] The enabled column uses the Settings rows' On/Off pill (`BarToggle`), not the square switch.
- [ ] Disabling opens the existing confirm dialog with the kind's last 24h Requests, what stops, how many queued messages will be held, and the refusal a person will read. Enabling applies at once.
- [ ] Last 24h Requests come from the existing Requests Breakdown and queued counts from the existing lanes read, summed per kind; no new route.
- [ ] The seven Settings are not rendered a second time as plain rows once the panel shows them; search and `?setting=` links to them land on the panel.
- [ ] The Requests tab's "By kind of work" table has a Status column: "On", or "Off since HH:MM" linking to the panel; `other` shows a dash. A disabled kind with no Requests in the range appears as a zero row.
- [ ] With a kind disabled in the runtime config, its actions are greyed out with the shared message as their tooltip: Sync on a Channel (`single`), Sync all and Reset and sync (`bulk`), bulk follow (`follow`), adding a Channel by handle (`handle`), Publish (`botApi`).
- [ ] One Playwright spec over a mocked API covers the panel, the confirm, the Status column and its zero row, the greyed actions and an Account without Jobs manage seeing no panel. Render tests for each new branching component, as the CRAP ratchet requires. Each mutation-checked, named in the commit body.
- [ ] Typecheck (build and tests), lint, the frontend unit tests and the frontend constants catalog pass.
