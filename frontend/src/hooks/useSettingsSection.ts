import { getRouteApi } from "@tanstack/react-router"

import {
  normalizeSettingsSection,
  type SettingsSection,
} from "@/lib/settingsSection"

const workspaceRoute = getRouteApi("/_tg/workspace")

export function useSettingsSection() {
  const { section } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  const activeSection = normalizeSettingsSection(section)

  const setActiveSection = (next: SettingsSection) => {
    const safe = normalizeSettingsSection(next)
    navigate({
      search: (prev) => ({ ...prev, section: safe }),
      replace: true,
    })
  }

  return { activeSection, setActiveSection }
}
