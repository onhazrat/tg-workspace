import type { ConfigurationCatalogResponse } from "@/client"
import type { CommandDef } from "@/lib/commands/types"

/** One lazy browser command whose searchable sub-view contains every entry. */
export function buildConfigurationCommands(
  catalog: ConfigurationCatalogResponse | undefined,
): CommandDef[] {
  const entries = catalog?.layers.flatMap((layer) => layer.entries ?? []) ?? []
  return [
    {
      id: "browse-configuration",
      kind: "entity-root",
      label: "Browse Configuration",
      keywords: [
        "config",
        "configuration",
        "settings",
        "environment",
        ...entries.flatMap((entry) => [entry.key, entry.label]),
      ],
      group: "Configuration",
      entityFlow: "open-configuration",
      disabled: () =>
        entries.length > 0
          ? { disabled: false }
          : { disabled: true, reason: "Configuration unavailable" },
      run: (ctx, payload) => {
        if (typeof payload === "string") ctx.openConfigurationEntry(payload)
      },
    },
  ]
}
