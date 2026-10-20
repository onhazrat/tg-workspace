# SET-05: AI preferences follow the Account

**What to build:** An Account's AI model, language and temperature are kept on
the Account rather than in one browser, so they follow it to every device.
They are Settings under AI & models with Setting scope "Your account"
(`ai.yours.model`, `ai.yours.language`, `ai.yours.temperature`), defaulting to
the deployment's default model and language. The first time an Account loads
this version, any values its browser had stored are uploaded if the Account
has none, and from then on the browser no longer stores them. When two
browsers disagree, the first one to load wins. Every place that reads or
changes them (the Action tab's run bar, Chat, Tag, Summary, translation
defaults) keeps working.

Spec: `.scratch/settings-one-page/spec.md` (stories 68–70; the AI preferences
decision). Plan decisions 13, 18.

**Context pointers:**

- Today the three values are browser-only entries in the frontend settings schema, read through `SettingsContext` by the Action run bar, Chat, Tag and Summary.
- A per-Account settings key is classified in the backend settings registry and written through the per-Account settings store; the publishing preferences key is the closest precedent.
- Prior-art tests: the settings-table-split guard; the scoped-storage invariants.

**Blocked by:** SET-02

**Status:** done

- [ ] A new per-Account settings key holds the three values, classified in the settings registry and declared as Settings with resolved defaults.
- [ ] The frontend reads and writes them through the Account; the browser keys for them are no longer written.
- [ ] A one-time upload sends the browser's stored values when the Account has none, and never overwrites values the Account already has.
- [ ] Route-seam tests: two Accounts keep separate values; defaults come from the deployment; a write through `PUT /settings/{settingId}` is what the Action tab reads.
- [ ] A Playwright spec seeds browser values, loads the app against an Account with none, and sees them uploaded once.
- [ ] The `scopedStorage` and architecture invariants still pass.

## Comments

- 2026-10-20: implemented on `set-05-ai-preferences` and merged into the integration branch `settings-one-page` in 2ddb6a9c.
  Open: the run bar's per-Key model memory (`modelForKey`) stays in the browser and can still switch the model after hydration on a device whose memory differs; handed to the integration branch's code review. The stored field names are the SettingsContext keys (`selectedModel`, `aiLanguage`, `aiTemperature`).
