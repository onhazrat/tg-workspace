# SET-03: Panels in the page's style, at parity, and the old panels gone

**What to build:** Every hand-written part of the Settings page looks like the
rest of it and like the Directory. Tables replace cards, add and edit forms
open from a pill, and destructive actions confirm. Nothing the old panels did
is lost.

- **Account topic:** see who is signed in and sign out; change name and email
  inline; change the password from a form; see today's usage per Budget;
  delete the Account behind a confirmation.
- **AI keys:** a table with an Add key form.
- **Bots and destinations:** tables, with the name looked up from a bot token
  or chat id, a bot Check action and a test message.
- **Setting groups:** a table whose rows expand into an editor, plus a New
  group form.
- **Network topic:** an Operator runs the proxy pool from a table (per-proxy
  slots, test results, live health, add, test all, reveal credentials) and
  has Tor's Test and Rotate there.
- **Operator topic:** users as a table with Add user and every row action
  (edit, delete, View as, export), quota overrides as a table with an Override
  form, and per-Account usage for a chosen day with Lift today.

Spec: `.scratch/settings-one-page/spec.md` (stories 54–64, 66–67). Plan
decision 11. Reference implementation: the B panel bodies and their kit on
branch [`prototype/settings-one-page` @ 2b81adbd](https://github.com/onhazrat/tg-workspace/tree/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af). Those are not at parity: they lack the
lookup, Check, test message, Tor actions and the restyled user dialogs.

**Context pointers:**

- Prototype panel bodies, port and complete to parity: [b-panels.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/components/settings-prototype/b-panels.tsx) (Account, AI keys, bots, destinations, proxies, Setting groups, users, quota limits and usage) on [b-kit.tsx](https://github.com/onhazrat/tg-workspace/blob/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af/frontend/src/components/settings-prototype/b-kit.tsx).
- What parity is measured against: today's bot management component (lookup, Check, test message), the Tor panel sections (Test, Rotate), the admin user actions menu and its edit / delete / View as / export dialogs.
- Prior-art tests: the admin and user-settings Playwright specs, rewritten rather than kept.

**Blocked by:** SET-02

**Status:** ready-for-agent

- [ ] Each panel listed above is rebuilt with only the page's primitives, on the production stores and client calls it used before; writes stay explicit and real.
- [ ] Parity with the old panels: bot and chat name auto-lookup, bot Check, test message, Tor Test and Rotate, and user edit / delete / View as / export as popover forms and confirmations, not the template's dialogs.
- [ ] Deleted: the old panel components and their now-unused parts, the template `UserSettings` and `Admin` components, and the Tor panel (its fields are Setting rows since SET-02).
- [ ] The admin and user-settings Playwright specs are rewritten against the new topics, with the same coverage (adding, editing, approving, deleting an Account; changing password; quota limits and lift).
- [ ] The CSS and focus-reveal invariants, View-as guards, CRAP ratchet and full suites pass.
