/**
 * What the Tools tab shows an Account (SET-01). Tools are not Settings: they
 * read or act on data rather than configure anything, so they left the
 * Settings tree for a tab of their own.
 */

export type ToolId = "logs" | "quick-message" | "network-telemetry" | "database"

export interface ToolEntry {
  id: ToolId
  title: string
}

/** The tools `permissions` (the registry's list for this Account) reach. */
export function visibleTools(permissions: readonly string[]): ToolEntry[] {
  const tools: ToolEntry[] = [
    { id: "logs", title: "Logs" },
    { id: "quick-message", title: "Quick message" },
  ]
  if (permissions.includes("logs:read_any"))
    tools.push({ id: "network-telemetry", title: "Network telemetry" })
  // One entry, not three: table sizes, import / export and the query console
  // are one panel (`DatabaseManagement`'s table view), and drawing it three
  // times would load and list the same tables three times.
  if (permissions.includes("data:admin"))
    tools.push({
      id: "database",
      title: "Table sizes, import / export and query console",
    })
  return tools
}
