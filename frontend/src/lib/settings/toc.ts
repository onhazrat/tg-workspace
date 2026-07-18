import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Braces,
  Cpu,
  Database,
  Globe,
  Layers,
  Layout,
  MessageSquare,
  RefreshCw,
  Send,
  Shield,
  Star,
  Trash2,
  Upload,
} from "lucide-react"

export type SettingsTocId =
  | "commonly-used"
  | "appearance"
  | "channels-sync"
  | "setting-groups"
  | "ai"
  | "network"
  | "proxy"
  | "tor"
  | "publishing"
  | "bot-credentials"
  | "destinations"
  | "quick-message"
  | "data"
  | "retention"
  | "table-sizes"
  | "transfer"
  | "query"
  | "danger"
  | "tools"
  | "diagnostics"
  | "runtime-config"

export interface SettingsTocNode {
  id: SettingsTocId
  label: string
  icon: LucideIcon
  children?: SettingsTocNode[]
}

/** Hierarchical Settings TOC — IDs are stable for `?section=` URLs. */
export const SETTINGS_TOC: SettingsTocNode[] = [
  { id: "commonly-used", label: "Commonly Used", icon: Star },
  { id: "appearance", label: "Appearance", icon: Layout },
  {
    id: "channels-sync",
    label: "Channels & Sync",
    icon: RefreshCw,
    children: [{ id: "setting-groups", label: "Setting Groups", icon: Layers }],
  },
  { id: "ai", label: "AI & Models", icon: Cpu },
  {
    id: "network",
    label: "Network",
    icon: Globe,
    children: [
      { id: "proxy", label: "Proxy", icon: Shield },
      { id: "tor", label: "Tor", icon: Globe },
    ],
  },
  {
    id: "publishing",
    label: "Publishing",
    icon: Send,
    children: [
      { id: "bot-credentials", label: "Bot Credentials", icon: Shield },
      { id: "destinations", label: "Destinations", icon: Send },
      { id: "quick-message", label: "Quick Message", icon: MessageSquare },
    ],
  },
  {
    id: "data",
    label: "Data",
    icon: Database,
    children: [
      { id: "retention", label: "Retention", icon: Database },
      { id: "table-sizes", label: "Table Sizes", icon: Layers },
      { id: "transfer", label: "Transfer", icon: Upload },
      { id: "query", label: "Query", icon: Braces },
      { id: "danger", label: "Danger Zone", icon: Trash2 },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Activity,
    children: [
      { id: "diagnostics", label: "Diagnostics", icon: Activity },
      { id: "runtime-config", label: "Runtime Config", icon: Braces },
    ],
  },
]

/** Legacy flat section ids → current TOC ids. */
const SECTION_ALIASES: Record<string, SettingsTocId> = {
  sync: "channels-sync",
  db: "data",
  "scraping-sync": "channels-sync",
  "network-security": "network",
  "data-management": "data",
  "ai-models": "ai",
}

const ALL_TOC_IDS: SettingsTocId[] = (() => {
  const ids: SettingsTocId[] = []
  const walk = (nodes: SettingsTocNode[]) => {
    for (const node of nodes) {
      ids.push(node.id)
      if (node.children) walk(node.children)
    }
  }
  walk(SETTINGS_TOC)
  return ids
})()

export const VALID_SETTINGS_SECTIONS = ALL_TOC_IDS

export type SettingsSection = SettingsTocId

export function normalizeSettingsSection(raw: unknown): SettingsSection {
  if (typeof raw !== "string" || !raw.trim()) return "commonly-used"
  const key = raw.trim()
  if (SECTION_ALIASES[key]) return SECTION_ALIASES[key]
  if ((ALL_TOC_IDS as string[]).includes(key)) return key as SettingsSection
  return "commonly-used"
}

export function findTocNode(id: SettingsSection): SettingsTocNode | undefined {
  const walk = (nodes: SettingsTocNode[]): SettingsTocNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node
      if (node.children) {
        const found = walk(node.children)
        if (found) return found
      }
    }
    return undefined
  }
  return walk(SETTINGS_TOC)
}

export function parentTocId(id: SettingsSection): SettingsSection | null {
  for (const node of SETTINGS_TOC) {
    if (node.id === id) return null
    if (node.children?.some((c) => c.id === id)) return node.id
  }
  return null
}

/** Whether this section renders SettingsView catalog sections. */
export function isCatalogBrowseSection(section: SettingsSection): boolean {
  return (
    section === "commonly-used" ||
    section === "appearance" ||
    section === "channels-sync" ||
    section === "ai"
  )
}
