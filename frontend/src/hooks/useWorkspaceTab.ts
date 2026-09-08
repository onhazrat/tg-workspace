import { getRouteApi } from "@tanstack/react-router"

import { VALID_TABS } from "@/constants"
import type { TabType } from "@/types"

const workspaceRoute = getRouteApi("/_tg/workspace")

export function useWorkspaceTab() {
  const { tab } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  const activeTab = (
    VALID_TABS.includes(tab as TabType) ? tab : "channels"
  ) as TabType

  const setActiveTab = (next: TabType | ((prev: TabType) => TabType)) => {
    const resolved = typeof next === "function" ? next(activeTab) : next
    const safe = VALID_TABS.includes(resolved) ? resolved : "channels"
    navigate({ search: (prev) => ({ ...prev, tab: safe }), replace: true })
  }

  return { activeTab, setActiveTab }
}
