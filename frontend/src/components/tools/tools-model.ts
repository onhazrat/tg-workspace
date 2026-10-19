/**
 * What the Tools tab shows an Account (SET-01). Tools are not Settings: they
 * read or act on data rather than configure anything, so they left the
 * Settings tree for a tab of their own.
 */

export type ToolId = "logs" | "quick-message" | "network-telemetry" | "database"

export interface ToolAccess {
  /** `data:admin`: table sizes, import / export and the query console. */
  canAdministerData: boolean
  /** `logs:read_any`: the network log telemetry reads. */
  canReadNetworkLogs: boolean
}

export interface ToolEntry {
  id: ToolId
  title: string
}

export function visibleTools(access: ToolAccess): ToolEntry[] {
  const tools: ToolEntry[] = [
    { id: "logs", title: "Logs" },
    { id: "quick-message", title: "Quick message" },
  ]
  if (access.canReadNetworkLogs)
    tools.push({ id: "network-telemetry", title: "Network telemetry" })
  // One entry, not three: table sizes, import / export and the query console
  // are one panel (`DatabaseManagement`'s table view), and drawing it three
  // times would load and list the same tables three times.
  if (access.canAdministerData)
    tools.push({
      id: "database",
      title: "Table sizes, import / export and query console",
    })
  return tools
}
