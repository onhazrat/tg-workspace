import { getRouteApi } from "@tanstack/react-router"
import { Search, X } from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BotManagement } from "@/components/BotManagement"
import { DatabaseManagement } from "@/components/DatabaseManagement"
import { DiagnosticsView } from "@/components/DiagnosticsView"
import { NetworkTelemetry } from "@/components/NetworkTelemetry"
import { RuntimeConfigView } from "@/components/RuntimeConfigView"
import { SettingGroupsPanel } from "@/components/SettingGroupsPanel"
import { SettingsView } from "@/components/SettingsView"
import { CommonlyUsedSection } from "@/components/settings/CommonlyUsedSection"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { SettingsSearchResults } from "@/components/settings/SettingsSearchResults"
import { SettingsTocNav } from "@/components/settings/SettingsTocNav"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgInput } from "@/components/ui/tg-input"
import { useData } from "@/contexts/DataContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useSettingsSection } from "@/hooks/useSettingsSection"
import {
  getCatalogEntry,
  isSettingModified,
  settingElementId,
} from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { searchSettings, suggestSettingsOperators } from "@/lib/settings/search"
import type { SettingsSection } from "@/lib/settings/toc"
import { NetworkSection } from "./settings/NetworkSection"

const summarizerRoute = getRouteApi("/_tg/summarizer")

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
  const { setting: deepLinkSetting } = summarizerRoute.useSearch()
  const navigate = summarizerRoute.useNavigate()
  const settings = useSettings()
  const {
    loadDBStats,
    loadLogs,
    loadSyncLogs,
    loadLLMLogs,
    loadEmbeddingLogs,
    loadNetworkLogs,
  } = useData()

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
    const dataSections: SettingsSection[] = [
      "data",
      "retention",
      "table-sizes",
      "transfer",
      "query",
      "danger",
    ]
    if (dataSections.includes(activeSettingsTab)) {
      void loadDBStats()
    }
    if (
      activeSettingsTab === "diagnostics" ||
      activeSettingsTab === "tools" ||
      activeSettingsTab === "network-telemetry"
    ) {
      void Promise.all([
        loadLogs(),
        loadSyncLogs(),
        loadLLMLogs(),
        loadEmbeddingLogs(),
        loadNetworkLogs(),
      ])
    }
  }, [
    activeSettingsTab,
    loadDBStats,
    loadLogs,
    loadSyncLogs,
    loadLLMLogs,
    loadEmbeddingLogs,
    loadNetworkLogs,
  ])

  // Deep-link: ?setting=<id> → navigate to group + scroll/highlight
  useEffect(() => {
    if (!deepLinkSetting) return
    const entry = getCatalogEntry(deepLinkSetting)
    if (!entry) return
    setHighlightId(deepLinkSetting)
    if (entry.control.kind === "panel") {
      setActiveSettingsTab(entry.control.sectionId as SettingsSection)
    } else {
      const sectionMap: Record<string, SettingsSection> = {
        appearance: "appearance",
        "channels-sync": "channels-sync",
        ai: "ai",
        network: "network",
        data: "retention",
        publishing: "publishing",
        tools: "diagnostics",
        jobs: "channels-sync",
      }
      setActiveSettingsTab(sectionMap[entry.group] ?? "commonly-used")
    }
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

  const renderContent = () => {
    if (isSearching) {
      return (
        <SettingsSearchResults
          hits={searchHits}
          highlightId={highlightId}
          onSelect={openSetting}
          isModified={isModified}
        />
      )
    }

    switch (activeSettingsTab) {
      case "commonly-used":
        return <CommonlyUsedSection highlightId={highlightId} />
      case "appearance":
      case "channels-sync":
      case "ai":
        return (
          <SettingsView
            activeSection={activeSettingsTab}
            highlightId={highlightId}
          />
        )
      case "setting-groups":
        return (
          <SettingAnchor
            settingId="panel-setting-groups"
            highlighted={highlightId === "panel-setting-groups"}
            className="space-y-6"
          >
            <h3 className="text-sm uppercase font-bold tracking-widest">
              Setting Groups
            </h3>
            <SettingGroupsPanel />
          </SettingAnchor>
        )
      case "network":
      case "proxy":
      case "tor":
        return (
          <NetworkSection focus={activeSettingsTab} highlightId={highlightId} />
        )
      case "publishing":
      case "bot-credentials":
      case "destinations":
      case "quick-message":
        return (
          <BotManagement focus={activeSettingsTab} highlightId={highlightId} />
        )
      case "data":
      case "retention":
      case "table-sizes":
      case "transfer":
      case "query":
      case "danger":
        return (
          <DatabaseManagement
            focus={activeSettingsTab}
            highlightId={highlightId}
          />
        )
      case "tools":
        return (
          <div className="space-y-10">
            <SettingAnchor
              settingId="panel-diagnostics"
              highlighted={highlightId === "panel-diagnostics"}
            >
              <DiagnosticsView />
            </SettingAnchor>
            <SettingAnchor
              settingId="panel-network-telemetry"
              highlighted={highlightId === "panel-network-telemetry"}
            >
              <NetworkTelemetry />
            </SettingAnchor>
          </div>
        )
      case "diagnostics":
        return (
          <SettingAnchor
            settingId="panel-diagnostics"
            highlighted={highlightId === "panel-diagnostics"}
          >
            <DiagnosticsView />
          </SettingAnchor>
        )
      case "network-telemetry":
        return (
          <SettingAnchor
            settingId="panel-network-telemetry"
            highlighted={highlightId === "panel-network-telemetry"}
          >
            <NetworkTelemetry />
          </SettingAnchor>
        )
      case "runtime-config":
        return (
          <SettingAnchor
            settingId="panel-runtime-config"
            highlighted={highlightId === "panel-runtime-config"}
          >
            <RuntimeConfigView />
          </SettingAnchor>
        )
      default:
        return <CommonlyUsedSection highlightId={highlightId} />
    }
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
        className={`flex-1 flex flex-col min-w-0 overflow-hidden bg-app-card transition-colors ${
          activeSettingsTab === "diagnostics" ||
          activeSettingsTab === "network-telemetry" ||
          activeSettingsTab === "runtime-config" ||
          activeSettingsTab === "tools"
            ? "terminal-theme text-app-ink"
            : ""
        }`}
      >
        <div className="sticky top-0 z-10 border-b border-app-ink/10 bg-app-card/95 backdrop-blur-sm px-6 py-3">
          <div className="relative flex items-center gap-2">
            <Search
              size={14}
              className="absolute left-3 opacity-40 pointer-events-none"
            />
            <TgInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings (@modified, @feature:ai, @id:…)"
              className="w-full pl-9 pr-9 py-2 normal-case tracking-normal"
              aria-label="Search settings"
              data-testid="settings-search"
            />
            {searchQuery ? (
              <TgIconButton
                aria-label="Clear search"
                className="absolute right-1"
                onClick={() => setSearchQuery("")}
              >
                <X size={14} />
              </TgIconButton>
            ) : null}
          </div>
          {operatorSuggestions.length > 0 && searchQuery.includes("@") ? (
            <div className="flex flex-wrap gap-1 mt-2">
              {operatorSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 border border-app-ink/15 opacity-60 hover:opacity-100"
                  onClick={() => {
                    const at = searchQuery.lastIndexOf("@")
                    const prefix =
                      at >= 0 ? searchQuery.slice(0, at) : searchQuery
                    setSearchQuery(`${prefix}${s} `)
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>

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
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
