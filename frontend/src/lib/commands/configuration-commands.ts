import type { ConfigurationCatalog } from "@/api"
import type { CommandDef } from "@/lib/commands/types"

/** One read-only palette destination per discovered configuration entry. */
export function buildConfigurationCommands(
  catalog: ConfigurationCatalog | undefined,
): CommandDef[] {
  if (!catalog) return []
  return catalog.layers.flatMap((layer) =>
    layer.entries.map((entry) => ({
      id: `open-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      kind: "action" as const,
      label: `Open config → ${entry.key}`,
      keywords: [
        "config",
        "configuration",
        "setting",
        layer.id,
        layer.label,
        entry.key,
        entry.label,
        entry.source,
        entry.description,
        entry.owner_id ?? "",
      ],
      group: "Configuration",
      getBadge: () => layer.id,
      run: (ctx) => ctx.openConfigurationEntry(entry.id),
    })),
  )
}
