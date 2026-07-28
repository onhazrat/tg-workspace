import { createFileRoute } from "@tanstack/react-router"

import App from "@/App"
import { TgProviders } from "@/components/TgProviders"
import type { SettingsSection } from "@/lib/settingsSection"
import { normalizeSettingsSection } from "@/lib/settingsSection"
import type { TabType } from "@/types"

const VALID_TABS: TabType[] = [
  "summary",
  "posts",
  "channels",
  "tag",
  "discover",
  "history",
  "chat",
  "settings",
]

export type SummarizerSearch = {
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
}

export const Route = createFileRoute("/_tg/summarizer")({
  validateSearch: (search: Record<string, unknown>): SummarizerSearch => {
    const raw = typeof search.tab === "string" ? search.tab : "summary"
    if (raw === "network") {
      return { tab: "settings", section: "network" }
    }
    const tab = VALID_TABS.includes(raw as TabType)
      ? (raw as TabType)
      : "summary"
    const result: SummarizerSearch = { tab }
    if (typeof search.section === "string") {
      result.section = normalizeSettingsSection(search.section)
    }
    if (typeof search.setting === "string" && search.setting.trim()) {
      result.setting = search.setting.trim()
    }
    if (typeof search.channelGroup === "string" && search.channelGroup.trim()) {
      result.channelGroup = search.channelGroup.trim()
    }
    if (typeof search.settingGroup === "string" && search.settingGroup.trim()) {
      result.settingGroup = search.settingGroup.trim()
    }
    if (typeof search.report === "string" && search.report.trim()) {
      result.report = search.report.trim()
    }
    return result
  },
  component: SummarizerPage,
  head: () => ({
    meta: [{ title: "Summarizer - TG Summarizer" }],
  }),
})

function SummarizerPage() {
  return (
    <TgProviders>
      <App />
    </TgProviders>
  )
}
