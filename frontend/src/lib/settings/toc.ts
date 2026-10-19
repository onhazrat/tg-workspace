import type { LucideIcon } from "lucide-react"
import {
  Braces,
  Cpu,
  Database,
  Globe,
  KeyRound,
  Layers,
  Layout,
  RefreshCw,
  Send,
  Shield,
  Star,
  UserRound,
  Users,
} from "lucide-react"

export type SettingsTocId =
  | "commonly-used"
  | "account"
  | "appearance"
  | "channels-sync"
  | "setting-groups"
  | "ai"
  | "ai-keys"
  | "network"
  | "proxy"
  | "tor"
  | "publishing"
  | "bot-credentials"
  | "destinations"
  | "retention"
  | "users"
  | "configuration"

export interface SettingsTocNode {
  id: SettingsTocId
  label: string
  icon: LucideIcon
  children?: SettingsTocNode[]
}

/**
 * Hierarchical Settings TOC — IDs are stable for `?section=` URLs.
 *
 * Account and Users hold what the template's /settings and /admin pages held
 * (SET-01). The tools (logs, quick message, telemetry, table sizes, import /
 * export, query) are not settings and live in the Tools tab.
 */
export const SETTINGS_TOC: SettingsTocNode[] = [
  { id: "commonly-used", label: "Commonly Used", icon: Star },
  { id: "account", label: "Account", icon: UserRound },
  { id: "appearance", label: "Appearance", icon: Layout },
  {
    id: "channels-sync",
    label: "Channels & Sync",
    icon: RefreshCw,
    children: [{ id: "setting-groups", label: "Setting Groups", icon: Layers }],
  },
  {
    id: "ai",
    label: "AI & Models",
    icon: Cpu,
    children: [{ id: "ai-keys", label: "AI Keys", icon: KeyRound }],
  },
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
    ],
  },
  { id: "retention", label: "Retention", icon: Database },
  { id: "users", label: "Users", icon: Users },
  { id: "configuration", label: "Configuration Catalog", icon: Braces },
]

/** Legacy flat section ids → current TOC ids. */
const SECTION_ALIASES: Record<string, SettingsTocId> = {
  sync: "channels-sync",
  db: "retention",
  data: "retention",
  "scraping-sync": "channels-sync",
  "network-security": "network",
  "data-management": "retention",
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
