import { createFileRoute } from "@tanstack/react-router"

import App from "@/App"
import { TgProviders } from "@/components/TgProviders"
import { VALID_TABS } from "@/constants"
import type { SettingsSection } from "@/lib/settingsSection"
import { normalizeSettingsSection } from "@/lib/settingsSection"
import type { TabType } from "@/types"

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
    for (const key of ["report", "summary", "chatSession", "tagRun"] as const) {
      const raw = search[key]
      if (typeof raw === "string" && raw.trim()) result[key] = raw.trim()
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
