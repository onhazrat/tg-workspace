import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  SETTINGS_SECTION_CONTENT,
  SettingsSearchBar,
} from "@/components/settings/SettingsHubParts"
import { SettingsSearchResults } from "@/components/settings/SettingsSearchResults"
import { SettingsTocNav } from "@/components/settings/SettingsTocNav"
import {
  deepLinkTarget,
  loadsDbStats,
  sectionThemeClass,
} from "@/components/settings/settings-hub-model"
import { useSettings } from "@/contexts/SettingsContext"
import { useLoadDBStats } from "@/hooks/useDBStats"
import { useSettingsSection } from "@/hooks/useSettingsSection"
import { isSettingModified, settingElementId } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { searchSettings, suggestSettingsOperators } from "@/lib/settings/search"
import type { SettingsSection } from "@/lib/settings/toc"

const workspaceRoute = getRouteApi("/_tg/workspace")

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export const SettingsHub: React.FC = () => {
  const {
    activeSection: activeSettingsTab,
    setActiveSection: setActiveSettingsTab,
  } = useSettingsSection()
  const { setting: deepLinkSetting } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const settings = useSettings()
  const loadDBStats = useLoadDBStats()

  const [searchQuery, setSearchQuery] = useState("")
  const debouncedQuery = useDebouncedValue(searchQuery, 200)
  const [highlightId, setHighlightId] = useState<string | null>(
    deepLinkSetting ?? null,
  )

  const isModified = useCallback(
    (entry: SettingCatalogEntry) => {
      if (entry.control.kind === "panel") return false
      const key = entry.sliceKey ?? entry.id
      const current = (settings as unknown as Record<string, unknown>)[
        key as string
      ]
      return isSettingModified(entry, current)
    },
    [settings],
  )

  const searchHits = useMemo(() => {
    if (!debouncedQuery.trim()) return []
    return searchSettings(debouncedQuery, { isModified })
  }, [debouncedQuery, isModified])

  const operatorSuggestions = useMemo(
    () => suggestSettingsOperators(searchQuery),
    [searchQuery],
  )

  const isSearching = debouncedQuery.trim().length > 0

  useEffect(() => {
    if (loadsDbStats(activeSettingsTab)) {
      void loadDBStats()
    }
    // The log prefetch that used to live here is gone: every component that
    // renders logs now owns an enabled query, so opening the tab fetches them.
  }, [activeSettingsTab, loadDBStats])

  // Deep-link: ?setting=<id> → navigate to group + scroll/highlight
  useEffect(() => {
    if (!deepLinkSetting) return
    const target = deepLinkTarget(deepLinkSetting)
    if (!target) return
    setHighlightId(deepLinkSetting)
    setActiveSettingsTab(target.section)
    if (!target.scroll) return
    requestAnimationFrame(() => {
      const scrollToTarget = () => {
        document
          .getElementById(settingElementId(deepLinkSetting))
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
      }
      scrollToTarget()
      // Section content may mount one frame after setActiveSettingsTab.
      requestAnimationFrame(scrollToTarget)
    })
    const clear = setTimeout(() => setHighlightId(null), 2500)
    return () => clearTimeout(clear)
  }, [deepLinkSetting, setActiveSettingsTab])

  const openSetting = (entry: SettingCatalogEntry) => {
    setSearchQuery("")
    const nextSection =
      entry.control.kind === "panel"
        ? (entry.control.sectionId as SettingsSection)
        : undefined
    navigate({
      search: (prev) => ({
        ...prev,
        tab: "settings" as const,
        setting: entry.id,
        ...(nextSection ? { section: nextSection } : {}),
      }),
      replace: true,
    })
  }

  return (
    <div className="flex h-full -m-8">
      <aside className="hidden md:flex w-64 border-r border-app-ink/10 bg-app-muted/50 p-6 flex-col gap-6 shrink-0 overflow-y-auto">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-4 opacity-50">
            Settings
          </h2>
          <SettingsTocNav
            activeSection={activeSettingsTab}
            onSelect={setActiveSettingsTab}
          />
        </div>
      </aside>

      <div
        className={`flex-1 flex flex-col min-w-0 overflow-hidden bg-app-card transition-colors ${sectionThemeClass(
          activeSettingsTab,
        )}`}
      >
        <SettingsSearchBar
          query={searchQuery}
          suggestions={operatorSuggestions}
          onQueryChange={setSearchQuery}
        />

        {/* Derived from the `?section=` param, never hand-typed, so it cannot
            drift out of sync with the route. Inspect this attribute to see which
            section the URL actually resolved to; React DevTools names the
            component that rendered inside it. */}
        <div
          className="flex-1 p-8 overflow-y-auto"
          data-testid={
            isSearching
              ? "settings-section-search"
              : `settings-section-${activeSettingsTab}`
          }
        >
          {isSearching ? (
            <SettingsSearchResults
              hits={searchHits}
              highlightId={highlightId}
              onSelect={openSetting}
              isModified={isModified}
            />
          ) : (
            SETTINGS_SECTION_CONTENT[activeSettingsTab]({
              highlightId,
              deepLinkSetting,
            })
          )}
        </div>
      </div>
    </div>
  )
}
