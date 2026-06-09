import { createFileRoute } from "@tanstack/react-router"

import App from "@/App"
import { TgProviders } from "@/components/TgProviders"
import { normalizeSettingsSection } from "@/lib/settingsSection"
import type { SettingsSection } from "@/lib/settingsSection"
import type { TabType } from "@/types"

const VALID_TABS: TabType[] = [
  "summary",
  "posts",
  "channels",
  "history",
  "chat",
  "settings",
]

export type SummarizerSearch = {
  tab?: TabType
  section?: SettingsSection
}

export const Route = createFileRoute("/_tg/summarizer")({
  validateSearch: (search: Record<string, unknown>): SummarizerSearch => {
    const raw = typeof search.tab === "string" ? search.tab : "summary"
    if (raw === "network") {
      return { tab: "settings", section: "network" }
    }
    const tab = VALID_TABS.includes(raw as TabType) ? (raw as TabType) : "summary"
    const result: SummarizerSearch = { tab }
    if (typeof search.section === "string") {
      result.section = normalizeSettingsSection(search.section)
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
