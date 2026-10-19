/**
 * PROTOTYPE, throw away. What left Settings because it is a tool, not a
 * setting: logs, telemetry, database, import / export, quick message.
 * Admin-only tools follow the same signal the current Settings tab uses.
 */
import type React from "react"
import { BotManagement } from "@/components/BotManagement"
import { DatabaseManagement } from "@/components/DatabaseManagement"
import { DiagnosticsView } from "@/components/DiagnosticsView"
import { NetworkTelemetry } from "@/components/NetworkTelemetry"
import { useCanManageJobs } from "@/hooks/useJobsStatus"

function Tool({
  title,
  id,
  children,
}: {
  title: string
  id: string
  children: React.ReactNode
}) {
  return (
    <section
      id={`tool-${id}`}
      className="overflow-hidden rounded-xl border border-app-ink/10 bg-app-card shadow-sm"
    >
      <header className="border-b border-app-ink/10 bg-app-muted/20 px-4 py-3">
        <h3 className="text-sm font-bold">{title}</h3>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function ToolsTab() {
  const admin = useCanManageJobs()
  return (
    <div className="space-y-4">
      <Tool title="Logs" id="logs">
        <DiagnosticsView />
      </Tool>
      <Tool title="Quick message" id="quick-message">
        <BotManagement focus="quick-message" />
      </Tool>
      {admin && (
        <>
          <Tool title="Network telemetry" id="network-telemetry">
            <NetworkTelemetry />
          </Tool>
          <Tool title="Table sizes" id="table-sizes">
            <DatabaseManagement focus="table-sizes" />
          </Tool>
          <Tool title="Import / export" id="transfer">
            <DatabaseManagement focus="transfer" />
          </Tool>
          <Tool title="Query console" id="query">
            <DatabaseManagement focus="query" />
          </Tool>
        </>
      )}
    </div>
  )
}
