import { WORKSPACE_TABS } from "@/constants"
import type { CommandContext, CommandDef } from "@/lib/commands/types"

export function buildNavigateCommands(): CommandDef[] {
  const workspaceCommands = WORKSPACE_TABS.map((tab) => ({
    id: `navigate-tab-${tab.id}`,
    kind: "action" as const,
    label: `Go to ${tab.label}`,
    keywords: [tab.id, tab.label, "navigate", "tab", "go"],
    group: "Navigate",
    run: (ctx: CommandContext) => {
      ctx.setActiveTab(tab.id)
    },
  }))

  // "Go to Settings → topic" is built from the registry with the other
  // Settings commands (`settings-schema.ts`).

  // The browser keeps Cmd+W and Cmd+Shift+T, so closing and reopening a tab
  // without the mouse lives here (TABS-01).
  const tabCommands: CommandDef[] = [
    {
      id: "tab-close",
      kind: "action",
      label: "Close tab",
      keywords: ["close", "tab"],
      group: "Navigate",
      run: (ctx) => {
        ctx.workspaceTabs.closeTab(ctx.workspaceTabs.active)
      },
    },
    {
      id: "tab-reopen",
      kind: "action",
      label: "Reopen closed tab",
      keywords: ["reopen", "restore", "undo", "closed", "tab"],
      group: "Navigate",
      run: (ctx) => {
        ctx.workspaceTabs.reopenLastTab()
      },
    },
  ]

  return [...workspaceCommands, ...tabCommands]
}
