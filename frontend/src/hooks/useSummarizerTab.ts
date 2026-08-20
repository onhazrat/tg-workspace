import { getRouteApi } from "@tanstack/react-router"

import { VALID_TABS } from "@/constants"
import type { TabType } from "@/types"

const summarizerRoute = getRouteApi("/_tg/summarizer")

export function useSummarizerTab() {
  const { tab } = summarizerRoute.useSearch()
  const navigate = summarizerRoute.useNavigate()

  const activeTab = (
    VALID_TABS.includes(tab as TabType) ? tab : "summary"
  ) as TabType

  const setActiveTab = (next: TabType | ((prev: TabType) => TabType)) => {
    const resolved = typeof next === "function" ? next(activeTab) : next
    const safe = VALID_TABS.includes(resolved) ? resolved : "summary"
    navigate({ search: (prev) => ({ ...prev, tab: safe }), replace: true })
  }

  return { activeTab, setActiveTab }
}
