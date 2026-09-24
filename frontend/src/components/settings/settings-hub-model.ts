import { getCatalogEntry } from "@/lib/settings/catalog"
import type { SettingsFeatureGroup } from "@/lib/settings/catalog-types"
import type { SettingsSection } from "@/lib/settings/toc"

/** Sections whose panels read the table-size stats, so opening one loads them. */
const DB_STATS_SECTIONS: ReadonlySet<SettingsSection> = new Set([
  "data",
  "retention",
  "table-sizes",
  "transfer",
  "query",
])

export const loadsDbStats = (section: SettingsSection): boolean =>
  DB_STATS_SECTIONS.has(section)

/** The diagnostic sections draw in the terminal theme rather than the card's. */
const TERMINAL_SECTIONS: ReadonlySet<SettingsSection> = new Set([
  "diagnostics",
  "network-telemetry",
  "configuration",
  "tools",
])

export const sectionThemeClass = (section: SettingsSection): string =>
  TERMINAL_SECTIONS.has(section) ? "terminal-theme text-app-ink" : ""

/** Where a catalog entry's group lives in the TOC. */
const GROUP_SECTIONS: Record<SettingsFeatureGroup, SettingsSection> = {
  appearance: "appearance",
  "channels-sync": "channels-sync",
  ai: "ai",
  network: "network",
  data: "retention",
  publishing: "publishing",
  tools: "diagnostics",
  jobs: "channels-sync",
}

/** A Configuration Catalog id, which that view scrolls to itself. */
const CONFIGURATION_ID = /^(deployment|global|user|specialized|frontend):/

/**
 * Where `?setting=<id>` lands, and whether the hub scrolls to it.
 *
 * `null` is an id nothing knows, which is left alone rather than highlighted.
 * A Configuration Catalog id opens that view without scrolling, because the
 * catalog owns its own scroll once its rows have hydrated.
 */
export function deepLinkTarget(
  id: string,
): { section: SettingsSection; scroll: boolean } | null {
  if (CONFIGURATION_ID.test(id))
    return { section: "configuration", scroll: false }
  const entry = getCatalogEntry(id)
  if (!entry) return null
  if (entry.control.kind === "panel")
    return { section: entry.control.sectionId as SettingsSection, scroll: true }
  return { section: GROUP_SECTIONS[entry.group], scroll: true }
}

/** Replaces the `@word` being typed with the picked operator. */
export function applyOperatorSuggestion(query: string, operator: string) {
  const at = query.lastIndexOf("@")
  const prefix = at >= 0 ? query.slice(0, at) : query
  return `${prefix}${operator} `
}
