import { VALID_TABS } from "@/constants"
import type { SettingsSection } from "@/lib/settingsSection"
import { normalizeSettingsSection } from "@/lib/settingsSection"
import type { TabType } from "@/types"

export type WorkspaceSearch = {
  tab?: TabType
  section?: SettingsSection
  /** Deep-link to a catalog setting id (scroll + highlight). */
  setting?: string
  /** Active group filter on the Channels tab (setting group id). */
  channelGroup?: string
  /** Selected setting group in Settings → Channels & Sync. */
  settingGroup?: string
  /**
   * Saved Discover report to open on the Discover tab.
   *
   * In the URL rather than component state so History can deep-link a report,
   * and so reopening one is shareable and survives a reload. Absent means
   * "the most recent report".
   */
  report?: string
  /**
   * The other three artifact kinds, on the same terms.
   *
   * Opening an artifact from History is a navigation — it should survive a
   * reload and be worth copying out of the address bar. Only Discover reports
   * were deep-linkable before; a summary was restored through component state
   * and a chat could not be reopened at all.
   */
  summary?: string
  chatSession?: string
  tagRun?: string
}

/** The id-like params: kept trimmed when non-blank, dropped otherwise. */
const ID_PARAMS = [
  "setting",
  "channelGroup",
  "settingGroup",
  "report",
  "summary",
  "chatSession",
  "tagRun",
] as const

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined
}

function workspaceTab(raw: unknown): TabType {
  return VALID_TABS.includes(raw as TabType) ? (raw as TabType) : "channels"
}

/**
 * `validateSearch` for `/workspace`. The legacy `?tab=network` became the
 * Network section of Settings, and nothing else survives that redirect.
 */
export function validateWorkspaceSearch(
  search: Record<string, unknown>,
): WorkspaceSearch {
  if (search.tab === "network") return { tab: "settings", section: "network" }
  const result: WorkspaceSearch = { tab: workspaceTab(search.tab) }
  if (typeof search.section === "string") {
    result.section = normalizeSettingsSection(search.section)
  }
  for (const key of ID_PARAMS) {
    const value = trimmedString(search[key])
    if (value) result[key] = value
  }
  return result
}
