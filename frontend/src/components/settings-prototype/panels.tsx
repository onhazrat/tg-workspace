/**
 * PROTOTYPE (settings redesign), throwaway. The "true panels" (credentials,
 * proxies, lists of rows) stay hand-written; this maps a panel id to the
 * existing production component, framed the same way in every variant.
 */
import { ArrowLeft } from "lucide-react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { BotManagement } from "@/components/BotManagement"
import { SettingGroupsPanel } from "@/components/SettingGroupsPanel"
import { AIKeysPanel } from "@/components/settings/ai/AIKeysPanel"
import { ProxyPanel } from "@/components/settings/network/ProxyPanel"
import { TorPanel } from "@/components/settings/network/TorPanel"
import { PublicationOptionsPanel } from "@/components/settings/publishing/PublicationOptionsPanel"
import { SETTINGS_SECTION_CONTENT } from "@/components/settings/SettingsHubParts"
import { JobRow } from "@/components/settings/SyncSectionParts"
import {
  loadsDbStats,
  sectionThemeClass,
} from "@/components/settings/settings-hub-model"
import { useSettings } from "@/contexts/SettingsContext"
import { useLoadDBStats } from "@/hooks/useDBStats"
import { JOB_LABELS, useJobToggles } from "@/hooks/useJobToggles"
import type { SettingsSection } from "@/lib/settings/toc"
import { cn } from "@/lib/utils"
import { MOVED_OUT, PANEL_INFO, type ProtoPanelId } from "./model"
import { ScopeBadge, useCanWrite } from "./ProtoRow"

const Jobs: React.FC = () => {
  const { jobStatus, refreshJobStatus, toggleJob } = useJobToggles()
  const [running, setRunning] = useState<string | null>(null)
  useEffect(() => {
    refreshJobStatus()
  }, [refreshJobStatus])
  return (
    <div className="space-y-2">
      {Object.entries(JOB_LABELS).map(([id, label]) => (
        <JobRow
          key={id}
          label={label}
          entry={jobStatus[id]}
          triggering={running === id}
          onToggle={(on) => toggleJob(id, on)}
          onRun={async () => {
            setRunning(id)
            try {
              await api.triggerJob(id)
              toast.success(`Triggered ${label}`)
              await refreshJobStatus()
            } finally {
              setRunning(null)
            }
          }}
        />
      ))}
    </div>
  )
}

const PublicationOptions: React.FC = () => {
  const s = useSettings()
  return (
    <PublicationOptionsPanel
      citationStyle={s.citationStyle}
      linkPreviews={s.linkPreviews}
      timeZone={s.timeZone}
      onCitationStyle={s.setCitationStyle}
      onLinkPreviews={s.setLinkPreviews}
      onTimeZone={s.setTimeZone}
    />
  )
}

export const PANEL_BODY: Record<ProtoPanelId, React.FC> = {
  "ai-keys": AIKeysPanel,
  "setting-groups": SettingGroupsPanel,
  jobs: Jobs,
  bots: () => <BotManagement focus="bot-credentials" />,
  destinations: () => <BotManagement focus="destinations" />,
  "publication-options": PublicationOptions,
  proxy: () => <ProxyPanel highlightId={null} />,
  tor: () => <TorPanel highlightId={null} />,
}

/** A panel with the same header as a row: name, scope, one line on what it is. */
export const ProtoPanel: React.FC<{
  id: ProtoPanelId
  bare?: boolean
}> = ({ id, bare }) => {
  const info = PANEL_INFO[id]
  const canWrite = useCanWrite(info.scope)
  const Body = PANEL_BODY[id]
  return (
    <section
      id={`proto-panel-${id}`}
      className={cn(
        "scroll-mt-28",
        !bare && "border-l-2 border-transparent py-4 pl-4 pr-2",
      )}
    >
      {!bare ? (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">{info.label}</h4>
            <ScopeBadge scope={info.scope} locked={!canWrite} />
          </div>
          <p className="mt-1 text-[13px] text-app-ink/60">{info.blurb}</p>
        </div>
      ) : null}
      {canWrite ? (
        <Body />
      ) : (
        <p className="rounded border border-dashed border-app-ink/15 p-4 text-[13px] text-app-ink/60">
          Your Admin manages this for the whole deployment.
        </p>
      )}
    </section>
  )
}

/**
 * A tool that leaves Settings, drawn where an Admin "System" page would put
 * it. The body is the production section, unchanged.
 */
export const SystemTool: React.FC<{ section: string; onBack: () => void }> = ({
  section,
  onBack,
}) => {
  const tool = MOVED_OUT.find((m) => m.section === section)
  const id = section as SettingsSection
  const loadDBStats = useLoadDBStats()
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" })
    if (loadsDbStats(id)) void loadDBStats()
  }, [id, loadDBStats])
  return (
    <div
      ref={top}
      className={cn("min-h-full scroll-mt-8", sectionThemeClass(id))}
    >
      <div className="border-b border-app-ink/10 px-8 py-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] text-app-ink/60 hover:text-app-ink"
        >
          <ArrowLeft size={14} /> Back to Settings
        </button>
        <div className="mt-2 text-xs text-app-ink/50">Admin → System</div>
        <h3 className="text-lg font-semibold">{tool?.label}</h3>
        <p className="text-[13px] text-app-ink/55">
          Moves out of Settings because it is {tool?.why}.
        </p>
      </div>
      <div className="p-8">
        {SETTINGS_SECTION_CONTENT[id]({ highlightId: null })}
      </div>
    </div>
  )
}
