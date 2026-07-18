# Settings catalog

The Settings hub is driven by a single catalog that feeds the UI, flatten search, and command palette.

## Source of truth

- Catalog: [`src/lib/settings/catalog.ts`](../src/lib/settings/catalog.ts)
- Types: [`src/lib/settings/catalog-types.ts`](../src/lib/settings/catalog-types.ts)
- Search provider seam: [`src/lib/settings/search.ts`](../src/lib/settings/search.ts)
- TOC IA: [`src/lib/settings/toc.ts`](../src/lib/settings/toc.ts)
- Palette generation: [`src/lib/commands/settings-schema.ts`](../src/lib/commands/settings-schema.ts) builds commands from the catalog

Persistence stays split (`app` schema store / network / theme / jobs). Catalog entries declare a `source` and do not merge stores.

## Catalog entry rules

Each knob or searchable panel target has:

| Field | Purpose |
|---|---|
| `id` | Stable deep-link id (`?setting=<id>`) and `@id:` search |
| `label` / `description` / `keywords` | UI + local string ranking (+ future embedding corpus) |
| `group` | Feature group for TOC / `@feature:` |
| `control` | `boolean` / `number` / `enum` / `textarea` / `days` / `panel` |
| `source` | `app` \| `network` \| `theme` \| `jobs` |
| `defaultValue` | Modified accent + Reset to default |

Panel targets (`control.kind === "panel"`) navigate to a TOC leaf (`sectionId`).

## Search

- Empty query → TOC browse (no flatten).
- Non-empty → flatten matches across categories (VS Code-style).
- Debounced ~200ms in the hub header.
- Local string ranking only today, behind `SettingsSearchProvider` so embeddings/TF-IDF can plug in later.

### Operators (v1)

| Operator | Effect |
|---|---|
| `@modified` | Rows whose value ≠ default (needs `isModified` callback) |
| `@feature:<group>` | Restrict to a feature group (`appearance`, `channels-sync`, `ai`, `network`, …) |
| `@id:<id>` | Exact catalog id |

Funnel/`@` suggestions appear while typing operators.

## TOC ids

Stable for `?tab=settings&section=<id>` (legacy aliases: `sync` → `channels-sync`, `db` → `data`, `telemetry` → `network-telemetry`):

- `commonly-used` — static curated list (`COMMONLY_USED_SETTING_IDS`)
- `appearance`, `channels-sync` (+ leaf `setting-groups`), `ai`
- `network` (+ `proxy`, `tor`)
- `publishing` (+ `bot-credentials`, `destinations`, `quick-message`)
- `data` (+ `retention`, `table-sizes`, `transfer`, `query`, `danger`)
- `tools` (+ `diagnostics`, `network-telemetry`, `runtime-config`)

Parents with children show a twistie (chevron): the twistie expands/collapses without selecting; clicking the row label selects and navigates (`?section=`). Expand state persists in `localStorage` (`settings-toc-expanded`) for the session.

Deep-link: `?setting=<catalogId>` scrolls/highlights the row (or opens a panel target). Panel targets:
- `panel-diagnostics` → system / LLM / sync / embedding logs
- `panel-network-telemetry` → Network Telemetry alone
- `panel-runtime-config` → Runtime Config

## Advanced Mode

Removed. All settings are always visible; search replaces progressive disclosure. Leftover `advancedMode` localStorage is ignored.

## Palette parity

`buildSettingCommands()` is generated from the catalog. Legacy command ids (minus Advanced Mode triples) are gated by `LEGACY_SETTING_COMMAND_IDS` in tests. New sync-interval editors are additive.

## UI primitives

Settings rows use TG primitives (`SettingRow` → `TgToggle` / `TgInput` / `TgSegmentedControl` / `TgIconButton`). See [`tg-ui.md`](./tg-ui.md).
