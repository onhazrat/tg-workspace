import { VALID_TABS } from "@/constants"
import {
  addFunnel,
  emptyFilter,
  filterNames,
  printChannelFilter,
} from "@/lib/channels/channel-filter"
import type { SettingsSection } from "@/lib/settingsSection"
import { normalizeSettingsSection } from "@/lib/settingsSection"
import { tabFromSearch, tabSearch } from "@/lib/workspace-tabs"
import type { TabType } from "@/types"

export type WorkspaceSearch = {
  tab?: TabType
  section?: SettingsSection
  /** Deep-link to a catalog setting id (scroll + highlight). */
  setting?: string
  /**
   * The Channel filter on the Channels tab, in its text form
   * (`lib/channels/channel-filter.ts`). It replaced `channelGroup`, whose old
   * links become a one-Condition filter on that Setting group.
   */
  channelFilter?: string
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

/** The string params: kept trimmed when non-blank, dropped otherwise. */
const ID_PARAMS = [
  "setting",
  "channelFilter",
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
  const legacyGroup = trimmedString(search.channelGroup)
  if (legacyGroup && !result.channelFilter) {
    // No group names here, so it is written by id, which reads back.
    result.channelFilter = printChannelFilter(
      addFunnel(emptyFilter(), "group", legacyGroup),
      filterNames([]),
    )
  }
  // Only the active tab's Artifact param means anything (TABS-01). An old
  // `?summary=` riding along on `?tab=posts` would otherwise reopen that
  // Summary the next time the Summary tab was focused.
  return tabSearch(result, tabFromSearch(result))
}
