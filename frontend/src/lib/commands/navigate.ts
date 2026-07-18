import { WORKSPACE_TABS } from "@/constants"
import type { CommandContext, CommandDef } from "@/lib/commands/types"
import {
  SETTINGS_TOC,
  type SettingsSection,
  type SettingsTocNode,
} from "@/lib/settings/toc"

function flattenToc(
  nodes: SettingsTocNode[],
): { id: SettingsSection; label: string }[] {
  const out: { id: SettingsSection; label: string }[] = []
  for (const node of nodes) {
    out.push({ id: node.id, label: node.label })
    if (node.children) {
      for (const child of node.children) {
        out.push({ id: child.id, label: child.label })
      }
    }
  }
  return out
}

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

  const settingsLeaves = flattenToc(SETTINGS_TOC)
  const settingsCommands = settingsLeaves.map((tab) => ({
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

  // Preserve legacy navigate ids that bookmarks / affinity may still reference.
  const legacyAliases: CommandDef[] = [
    {
      id: "navigate-settings-sync",
      kind: "action",
      label: "Open Settings → Channels & Sync",
      keywords: ["sync", "scraping", "settings", "navigate", "legacy"],
      group: "Navigate",
      run: (ctx) => {
        ctx.setActiveTab("settings")
        ctx.setActiveSection("channels-sync")
      },
    },
    {
      id: "navigate-settings-db",
      kind: "action",
      label: "Open Settings → Data",
      keywords: ["db", "data", "settings", "navigate", "legacy"],
      group: "Navigate",
      run: (ctx) => {
        ctx.setActiveTab("settings")
        ctx.setActiveSection("data")
      },
    },
  ]

  return [...workspaceCommands, ...settingsCommands, ...legacyAliases]
}
