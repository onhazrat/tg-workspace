import { useQuery } from "@tanstack/react-query"
import type React from "react"

import { api } from "@/api"
import { BotManagement } from "@/components/BotManagement"
import { DatabaseManagement } from "@/components/DatabaseManagement"
import { DiagnosticsView } from "@/components/DiagnosticsView"
import { NetworkTelemetry } from "@/components/NetworkTelemetry"
import { queryKeys } from "@/hooks/queryKeys"
import { useNetworkLogsQuery } from "@/hooks/useLogs"
import type { DBStats } from "@/types"
import { type ToolId, visibleTools } from "./tools-model"

const TOOL_BODIES: Record<ToolId, () => React.ReactNode> = {
  logs: () => <DiagnosticsView />,
  "quick-message": () => <BotManagement focus="quick-message" />,
  "network-telemetry": () => <NetworkTelemetry />,
  database: () => <DatabaseManagement focus="table-sizes" />,
}

/**
 * The Tools tab (SET-01): what left Settings because it is a tool, not a
 * setting. Restyling it like the Settings page is a later ticket.
 *
 * ## How it knows the Permissions
 *
 * The server publishes nobody's permission set (see `useCanManageJobs`), so
 * each gated tool is shown when the read it starts with succeeds: the table
 * stats for `data:admin` and the network log list for `logs:read_any`. Both
 * are reads the tools make anyway, so an Account that holds the Permission
 * pays no extra request, and one that does not pays one 403 each.
 * `retry: false` because that 403 is the answer.
 */
export const ToolsTab: React.FC = () => {
  const stats = useQuery({
    queryKey: queryKeys.dbStats,
    queryFn: () => api.getStats() as Promise<DBStats>,
    retry: false,
    staleTime: 30_000,
  })
  const networkLogs = useNetworkLogsQuery(true, { retry: false })
  const tools = visibleTools({
    canAdministerData: stats.isSuccess,
    canReadNetworkLogs: networkLogs.isSuccess,
  })
  return (
    <div className="space-y-4" data-testid="tools-tab">
      {tools.map((tool) => (
        <section
          key={tool.id}
          id={`tool-${tool.id}`}
          data-testid={`tool-${tool.id}`}
          className="overflow-hidden rounded-xl border border-app-ink/10 bg-app-card shadow-sm"
        >
          <header className="border-b border-app-ink/10 bg-app-muted/20 px-4 py-3">
            <h3 className="text-sm font-bold">{tool.title}</h3>
          </header>
          <div className="p-4">{TOOL_BODIES[tool.id]()}</div>
        </section>
      ))}
    </div>
  )
}
