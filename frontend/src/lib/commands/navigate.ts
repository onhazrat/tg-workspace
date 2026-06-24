import { SETTINGS_TABS, WORKSPACE_TABS } from "@/constants"
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

  const settingsCommands = SETTINGS_TABS.map((tab) => ({
    id: `navigate-settings-${tab.id}`,
    kind: "action" as const,
    label: `Open Settings → ${tab.label}`,
    keywords: [tab.id, tab.label, "settings", "navigate", "engine room", "go"],
    group: "Navigate",
    run: (ctx: CommandContext) => {
      ctx.setActiveTab("settings")
      ctx.setActiveSection(tab.id)
    },
  }))

  return [...workspaceCommands, ...settingsCommands]
}
