# SET-02: The Settings registry and the one-page Settings tab

**What to build:** The Settings tab becomes one scrolling page that lists every
Setting an Account can see. It is read from a registry the backend owns, and
each Setting is addressed by its Setting id. An Account sees each Setting's
Setting scope, whether it differs from its default (and what the default is
and where it comes from), and why it cannot change one when it cannot. It
searches by title, id, description or value with operators, and navigates by a
contents tree that follows the scroll, folds per topic and counts changed
values. It changes a Setting on Enter or blur; a refused write shows on the
row. An Operator with the new `settings:manage` Permission changes deployment
Settings from the same page. The command palette builds its Settings commands
from the registry. The old Settings hub is gone.

The hand-written panels (Account, AI keys, bots, destinations, Setting groups,
proxies, Tor, users, quotas) are embedded in their topics unchanged; SET-03
restyles them.

Spec: `.scratch/settings-one-page/spec.md`: stories 1–30, 32–46, 52–53, 65, 77,
the Registry, API and Page implementation decisions (the row shape there came
from the prototype), and the Testing decisions. Architecture:
`docs/migration/ADR-032-one-settings-registry.md`. Plan decisions 2, 4, 7, 10,
12, 14–17, 20, 22–24, 26, 28, 29. Reference implementation: variant B on
branch [`prototype/settings-one-page` @ 2b81adbd](https://github.com/onhazrat/tg-workspace/tree/2b81adbd5f7c086f91930fd58e0ba8cd0a62a8af). Its page code ports over, but its
prototype API does not: that one read staging and derived ids by heuristics.

**Blocked by:** SET-01

**Status:** ready-for-agent

- [ ] Every Setting (browser, account, deployment) is declared once on the backend with its Setting id, title, Account-facing description, type, bounds or choices, Setting scope, storage key and field, visibility (every Account or `settings:manage`), changing Permission and default source. A guard fails when a stored field has no declaration or two, when an id is declared twice, or when a declared browser Setting and the frontend schema disagree.
- [ ] Defaults are resolved through the real layers (account → deployment or `.env` seed → code), never restated; the Tor and publishing defaults that lived only in the browser move into the declarations.
- [ ] `GET /api/v1/settings/registry` returns the caller's visible topics and rows (absent, not redacted, when not visible) with `canEdit` and `lockReason` resolved, under a declared, closed response model.
- [ ] `PUT /api/v1/settings/{settingId}` validates against the declaration and writes through the owning settings aggregate. It answers 404 for an invisible id, 403 with the lock reason for one that cannot be changed, 422 for a value out of bounds, and the updated row on success. A reset is supported. View-as is refused unless elevated.
- [ ] `settings:manage` is a new Permission granted to the seeded Owner role on boot; it changes deployment Settings.
- [ ] The six quota defaults are deployment Settings stored in the existing quota row, defaulting to their `.env` values.
- [ ] The page draws only existing workspace primitives (the Directory bar, the Posts filter pills, the Channels bar toggle and popover, the shared segments and table card, `TgButton`, `TgConfirmDialog`), with the topics, Account / Operator wording and scope labels of the spec.
- [ ] Search matches title, id, `.env` name, description and value, highlights matches, ranks title and id matches first, and supports `@modified`, `@editable`, `@scope:…`, `@id:` and a Search syntax menu; Scope / Changed only / I can change pills and a count line.
- [ ] The contents tree: chevron per topic, panels and scope groups as children with counts, blue changed counts on topics and groups, the current topic opening on its own and closing once passed unless the Account chose otherwise, Expand / Collapse all, folding remembered per browser; a Contents pill on phones.
- [ ] Rows save on Enter or blur, Escape undoes, out-of-bounds input is refused before sending, a server refusal keeps the draft and shows the reason on the row, success shows "Saved" briefly; "Changed · default X" resets; the row menu copies the id and a link. The affected `SettingsContext` section refetches after a write so every tab sees it.
- [ ] `?setting=<id>` scrolls to and highlights the row; old `?section=` links land on the matching topic; `/settings` lands on Account › Profile and `/admin` on Operator › Users.
- [ ] The command palette offers a toggle or set command per editable Setting, "Go to Settings → topic" per topic, and a jump to any Setting by title or id.
- [ ] Deleted: the Settings hub, `SettingsView`, the section components, the settings catalog, the settings tree, "Commonly used", and the old settings Playwright specs.
- [ ] Tests on the spec's seams: the two routes with two live Accounts (visibility, writes per scope, refusals, reset, View-as, quota fallback, a write visible to the existing section route); Playwright specs with the registry mocked covering search, the tree, saving and refusals, links, the palette and the phone pill; the declaration guards mutation-tested. Route inventory, account isolation, approval gate and route hygiene pass with the new routes registered.
