# TG UI primitives

Shared components for the `/_tg/summarizer` shell live under [`src/components/ui/tg-*.tsx`](../src/components/ui/). Prefer these over admin/shadcn `Button` / `Input` / `LoadingButton`.

## Catalog

| Primitive | When to use |
|---|---|
| `TgButton` | Labeled actions. Variants: `primary`, `secondary`, `ghost`, `danger`, `dangerSoft`, `successSoft`, `infoSoft`, `link`. Pass `loading` / `loadingLabel` for async work. |
| `TgIconButton` | Icon-only actions; require `aria-label`. Optional `tooltip`. Variants: `ghost`, `frosted`, `danger`, `soft`. |
| `TgConfirmDialog` | Destructive / irreversible confirms. Do **not** use `window.confirm`. |
| `TgInput` / `TgTextarea` | Settings mono fields (`settings`) and toolbar search (`muted`). |
| `TgFieldLabel` | Settings-style field labels. |
| `TgHelpText` | Repeated `text-[10px] opacity-40 italic` helper copy under fields. |
| `TgSettingsSection` | Settings card shell. Optional `subtitle`, `actions`, `headerExtra`. |
| `TgToggle` | Square on/off switches (Appearance / Network / AI). |
| `selectTriggerClassName` (`tg-select-trigger.ts`) | Compact Channels-tab selects. |
| `TgSegmentedControl` | Exclusive option groups. Sizes: `sm`, `md`, `dense` (Appearance theme). |
| `TgHeroEmptyState` | Large empty states (History, etc.). Keep `LogEmptyState` for log tabs. |
| `TgSelectionChip` / `TgMetaChip` / `TgFilterChip` | Channel group chips, meta pills, post filters. |
| `tg-tooltip` / `tg-sonner` | Tooltips and toasts. Tooltip `asChild` preserves child `data-slot`. |

## Loading rules

- Any TG-shell async action that waits on the network should set `loading` on `TgButton` / `TgIconButton` / `TgConfirmDialog` while in flight.
- Prefer `loadingLabel` when the busy label differs from the idle label.
- Sync Section’s bulk reset confirm stays **inline** (buttons only) — not `TgConfirmDialog`.

## `tg-ui-allow` policy

Justified one-offs that cannot use an existing variant must include a one-line `// tg-ui-allow: <reason>` comment. The CI gate ([`scripts/check-tg-ui-duplicates.sh`](../scripts/check-tg-ui-duplicates.sh)) skips files with that comment. Prefer extending a primitive (`successSoft` / `infoSoft` / `link` / `dense`) over allowlisting.

Deferred UX patterns (leave as raw until a dedicated design): LogFilterBar density filters, Chat mode toggles, ChannelCard selection checkbox / dashed Add Tag.

Settings hub IA + searchable catalog: [`settings-catalog.md`](./settings-catalog.md).

## Left-behind greps

```bash
bun run test:tg-ui
```

Runs the hard-fail duplicate-class gate. Also useful:

```bash
rg 'window\\.confirm\\(' frontend/src/components
rg 'tg-ui-allow:' frontend/src/components
rg '<button' frontend/src/components --glob '*.tsx' | head
```

## Manual staging smoke

After deploy, spot-check light and dark:

- Channels: frosted card icons, Sync All primary hover, group chip focus ring
- Soft icons / `dangerSoft` confirms
- Appearance dense theme control
- Network Clear/Test `link` actions
- No native `window.confirm` on Logs clear or channel delete
