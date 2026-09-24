import { Search, X } from "lucide-react"
import type React from "react"
import { BotManagement } from "@/components/BotManagement"
import { ConfigurationCatalogView } from "@/components/ConfigurationCatalogView"
import { DatabaseManagement } from "@/components/DatabaseManagement"
import { DiagnosticsView } from "@/components/DiagnosticsView"
import { NetworkTelemetry } from "@/components/NetworkTelemetry"
import { SettingGroupsPanel } from "@/components/SettingGroupsPanel"
import { SettingsView } from "@/components/SettingsView"
import { AIKeysPanel } from "@/components/settings/ai/AIKeysPanel"
import { CommonlyUsedSection } from "@/components/settings/CommonlyUsedSection"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgInput } from "@/components/ui/tg-input"
import type { SettingsSection } from "@/lib/settings/toc"
import { NetworkSection } from "./NetworkSection"
import { applyOperatorSuggestion } from "./settings-hub-model"

interface SectionProps {
  highlightId: string | null
  /** The raw `?setting=` value, which the Configuration Catalog scrolls to. */
  deepLinkSetting?: string
}

type SectionRenderer = (props: SectionProps) => React.ReactNode

const catalog =
  (section: "appearance" | "channels-sync" | "ai") =>
  ({ highlightId }: SectionProps) => (
    <SettingsView activeSection={section} highlightId={highlightId} />
  )

const network =
  (focus: "network" | "proxy" | "tor") =>
  ({ highlightId }: SectionProps) => (
    <NetworkSection focus={focus} highlightId={highlightId} />
  )

const publishing =
  (
    focus: "publishing" | "bot-credentials" | "destinations" | "quick-message",
  ) =>
  ({ highlightId }: SectionProps) => (
    <BotManagement focus={focus} highlightId={highlightId} />
  )

const data =
  (focus: "data" | "retention" | "table-sizes" | "transfer" | "query") =>
  ({ highlightId }: SectionProps) => (
    <DatabaseManagement focus={focus} highlightId={highlightId} />
  )

const diagnostics = ({ highlightId }: SectionProps) => (
  <SettingAnchor
    settingId="panel-diagnostics"
    highlighted={highlightId === "panel-diagnostics"}
  >
    <DiagnosticsView />
  </SettingAnchor>
)

const networkTelemetry = ({ highlightId }: SectionProps) => (
  <SettingAnchor
    settingId="panel-network-telemetry"
    highlighted={highlightId === "panel-network-telemetry"}
  >
    <NetworkTelemetry />
  </SettingAnchor>
)

/**
 * What each `?section=` renders. A total record rather than a `switch`, so a
 * TOC id with no content is a type error instead of a silent default.
 */
export const SETTINGS_SECTION_CONTENT: Record<
  SettingsSection,
  SectionRenderer
> = {
  "commonly-used": ({ highlightId }) => (
    <CommonlyUsedSection highlightId={highlightId} />
  ),
  appearance: catalog("appearance"),
  "channels-sync": catalog("channels-sync"),
  ai: catalog("ai"),
  "ai-keys": ({ highlightId }) => (
    <SettingAnchor
      settingId="panel-ai-keys"
      highlighted={highlightId === "panel-ai-keys"}
      className="space-y-6"
    >
      <AIKeysPanel />
    </SettingAnchor>
  ),
  "setting-groups": ({ highlightId }) => (
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
  ),
  network: network("network"),
  proxy: network("proxy"),
  tor: network("tor"),
  publishing: publishing("publishing"),
  "bot-credentials": publishing("bot-credentials"),
  destinations: publishing("destinations"),
  "quick-message": publishing("quick-message"),
  data: data("data"),
  retention: data("retention"),
  "table-sizes": data("table-sizes"),
  transfer: data("transfer"),
  query: data("query"),
  tools: (props) => (
    <div className="space-y-10">
      {diagnostics(props)}
      {networkTelemetry(props)}
    </div>
  ),
  diagnostics,
  "network-telemetry": networkTelemetry,
  configuration: ({ deepLinkSetting }) => (
    <ConfigurationCatalogView focusId={deepLinkSetting} />
  ),
}

/** The search box and, while an `@` is being typed, the operator chips. */
export const SettingsSearchBar: React.FC<{
  query: string
  suggestions: string[]
  onQueryChange: (query: string) => void
}> = ({ query, suggestions, onQueryChange }) => (
  <div className="sticky top-0 z-10 border-b border-app-ink/10 bg-app-card/95 backdrop-blur-sm px-6 py-3">
    <div className="relative flex items-center gap-2">
      <Search
        size={14}
        className="absolute left-3 opacity-40 pointer-events-none"
      />
      <TgInput
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search settings (@modified, @feature:ai, @id:…)"
        className="w-full pl-9 pr-9 py-2 normal-case tracking-normal"
        aria-label="Search settings"
        data-testid="settings-search"
      />
      {query ? (
        <TgIconButton
          aria-label="Clear search"
          className="absolute right-1"
          onClick={() => onQueryChange("")}
        >
          <X size={14} />
        </TgIconButton>
      ) : null}
    </div>
    {suggestions.length > 0 && query.includes("@") ? (
      <div className="flex flex-wrap gap-1 mt-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 border border-app-ink/15 opacity-60 hover:opacity-100"
            onClick={() => onQueryChange(applyOperatorSuggestion(query, s))}
          >
            {s}
          </button>
        ))}
      </div>
    ) : null}
  </div>
)
