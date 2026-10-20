import type React from "react"

import { DatabaseManagement } from "@/components/DatabaseManagement"
import { DiagnosticsView } from "@/components/DiagnosticsView"
import { NetworkTelemetry } from "@/components/NetworkTelemetry"
import { useSettingsRegistry } from "@/components/settings-page/registry"
import { QuickMessageTool } from "./QuickMessageTool"
import { type ToolId, visibleTools } from "./tools-model"

const TOOL_BODIES: Record<ToolId, () => React.ReactNode> = {
  logs: () => <DiagnosticsView />,
  "quick-message": () => <QuickMessageTool />,
  "network-telemetry": () => <NetworkTelemetry />,
  database: () => <DatabaseManagement focus="table-sizes" />,
}

/**
 * The Tools tab (SET-01): what left Settings because it is a tool, not a
 * setting. Which gated tools show comes from the Permissions the Settings
 * registry lists for this Account, the same list the Settings page reads.
 */
export const ToolsTab: React.FC = () => {
  const tools = visibleTools(useSettingsRegistry().permissions)
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
