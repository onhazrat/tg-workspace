/**
 * PROTOTYPE (settings redesign, variant E), throwaway. The tools that left
 * Settings, as a workspace tab of their own. Logs are for everyone (an account
 * reads its own publish, LLM and embedding logs today); the rest is Admin-only.
 * Each body is the production section, unchanged.
 */
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { useEffect, useState } from "react"
import { SETTINGS_SECTION_CONTENT } from "@/components/settings/SettingsHubParts"
import {
  loadsDbStats,
  sectionThemeClass,
} from "@/components/settings/settings-hub-model"
import { useLoadDBStats } from "@/hooks/useDBStats"
import { useCanManageJobs } from "@/hooks/useJobsStatus"
import type { SettingsSection } from "@/lib/settings/toc"
import { cn } from "@/lib/utils"

const workspaceRoute = getRouteApi("/_tg/workspace")

const TOOLS: {
  id: SettingsSection
  label: string
  blurb: string
  adminOnly: boolean
}[] = [
  {
    id: "diagnostics",
    label: "Logs",
    blurb:
      "Your publish, LLM and embedding logs. Admins also see sync and network logs.",
    adminOnly: false,
  },
  {
    id: "network-telemetry",
    label: "Network telemetry",
    blurb: "How each proxy and Tor exit is performing.",
    adminOnly: true,
  },
  {
    id: "table-sizes",
    label: "Database",
    blurb: "Table sizes and row counts.",
    adminOnly: true,
  },
  {
    id: "query",
    label: "Query console",
    blurb: "Read rows from a table.",
    adminOnly: true,
  },
  {
    id: "transfer",
    label: "Import / export",
    blurb: "Move an account's data in or out.",
    adminOnly: true,
  },
]

export const SystemTabPrototype: React.FC = () => {
  const { variant } = workspaceRoute.useSearch()
  const isAdmin = useCanManageJobs()
  const tools = TOOLS.filter((t) => !t.adminOnly || isAdmin)
  const [current, setCurrent] = useState<SettingsSection>("diagnostics")
  const tool = tools.find((t) => t.id === current) ?? tools[0]
  const loadDBStats = useLoadDBStats()
  useEffect(() => {
    if (loadsDbStats(tool.id)) void loadDBStats()
  }, [tool.id, loadDBStats])

  if (variant !== "E")
    return (
      <p className="p-8 text-sm text-app-ink/50">
        The System tab belongs to settings prototype variant E.
      </p>
    )

  return (
    <div className="-m-8 flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r border-app-ink/10 bg-app-muted/40 p-4 md:flex">
        <div className="mb-2 px-2 text-xs font-semibold text-app-ink/50">
          System
        </div>
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCurrent(t.id)}
            className={cn(
              "rounded px-2 py-1.5 text-left text-sm",
              t.id === tool.id
                ? "bg-app-ink/10 font-semibold"
                : "text-app-ink/70 hover:bg-app-ink/5",
            )}
          >
            {t.label}
          </button>
        ))}
      </aside>
      <div
        className={cn(
          "min-w-0 flex-1 overflow-y-auto bg-app-card pb-32",
          sectionThemeClass(tool.id),
        )}
      >
        <div className="border-b border-app-ink/10 px-8 py-4">
          <h3 className="text-lg font-semibold">{tool.label}</h3>
          <p className="text-[13px] text-app-ink/55">{tool.blurb}</p>
        </div>
        <div className="p-8">
          {SETTINGS_SECTION_CONTENT[tool.id]({ highlightId: null })}
        </div>
      </div>
    </div>
  )
}
