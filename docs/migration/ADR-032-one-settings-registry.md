# ADR-032: One Settings registry, addressed by Setting id

**Status:** Accepted (2026-10-19). Plan: `docs/settings-registry-plan.md`.
Prototype: variant B on [`prototype/settings-one-page` @ 2b81adbd](https://github.com/onhazrat/tg-workspace/tree/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af), notes in
`.scratch/settings-one-page/prototype.md`.

## Context

What a Setting is was written down in four places: the frontend catalog
(labels, controls), the frontend schema (defaults, storage keys), the backend's
settings registry (which table holds a key) and the backend's default
functions. They drifted: some defaults (Tor, publishing) existed only in the
browser, and the Configuration catalog, a fifth copy, described `.env` values
separately. A Setting's address was its storage key (`retention_prefs` →
`reportRetentionDays`), so a link or a search named where a value was kept
rather than what it was.

The Settings tab is being rebuilt as one page that lists every Setting and
every piece of Configuration and says who may change each one.

## Decision

- **The backend owns one registry.** Every Setting is declared once on the
  backend: Setting id, title, description, type, bounds or choices, Setting
  scope, who may see and change it, and where its default comes from. Browser
  Settings are declared in the same list and stored by the frontend.
  Configuration rows are generated, `.env` values from `config.py` and the
  frontend build, constants from a generated catalog. A guard fails when a
  stored field has no declaration or two.
- **The Setting id is the public address**, separate from storage: topic, Setting
  scope, name (`retention.yours.discoverReportDays`). Links, search, the command
  palette and the page use it. Storage keys do not change.
- One write door per Setting (`PUT /settings/{settingId}`), validated against
  the declaration. The section endpoints stay until `SettingsContext` is rebuilt
  on the registry.

## Alternatives considered

- **The frontend assembles the page** from its own catalog and existing
  endpoints. Rejected: it keeps two copies of every default and cannot list
  `.env` values or constants, which only the backend knows.
- **Storage keys as addresses.** Rejected: they leak which table holds a value,
  and the account and deployment halves of one blob (`retention`,
  `retention_prefs`) would read as one Setting.
- **Ids derived from storage keys** by rule, as the prototype did. Rejected:
  the rule needed collision suffixes, and a public address should be chosen.

## Consequences

- Renaming a Setting id breaks existing links; ids carry no former names, so
  choose them with care.
- `catalog.ts`, the settings tree in `toc.ts` and `/data/configuration` go away,
  and the command palette builds its Settings commands from the registry.
- Secrets are Configuration rows that show only "set" or "not set", to every
  Account.
