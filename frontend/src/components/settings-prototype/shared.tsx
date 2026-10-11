// PROTOTYPE: Settings tab redesign. Variants on `?tab=settings&variant=`,
// 0 is today's hub untouched. Never merge; fold the winner in properly.
//
// Every variant renders the same regrouping, by who a setting affects:
// - "device": stored in this browser only (theme, card fields, AI defaults)
// - "account": stored on your account (sync_prefs, retention_prefs, keys, bots)
// - "deployment": one value for every account (settings_registry GLOBAL_KEYS)
// - "tool": not a setting at all (diagnostics, telemetry, SQL, table sizes)
// The scope of each catalog id mirrors backend/app/services/settings_registry.py.
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  BarChart3,
  Bot,
  Braces,
  Cpu,
  Database,
  Globe,
  KeyRound,
  Languages,
  Layers,
  Lock,
  Monitor,
  RefreshCw,
  Send,
  Shield,
  Upload,
  User,
  UserX,
} from "lucide-react"
import type React from "react"
import { BotManagement } from "@/components/BotManagement"
import { ConfigurationCatalogView } from "@/components/ConfigurationCatalogView"
import { DatabaseManagement } from "@/components/DatabaseManagement"
import { DiagnosticsView } from "@/components/DiagnosticsView"
import { NetworkTelemetry } from "@/components/NetworkTelemetry"
import { SettingGroupsPanel } from "@/components/SettingGroupsPanel"
import { AIKeysPanel } from "@/components/settings/ai/AIKeysPanel"
import { CatalogSettingRow } from "@/components/settings/CommonlyUsedSection"
import { NetworkSection } from "@/components/settings/NetworkSection"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import MyQuota from "@/components/UserSettings/MyQuota"
import UserInformation from "@/components/UserSettings/UserInformation"
import { useSettings } from "@/contexts/SettingsContext"
import { getCatalogEntry, isSettingModified } from "@/lib/settings/catalog"
import { cn } from "@/lib/utils"

export type Scope = "device" | "account" | "deployment" | "tool"

export const SCOPE_META: Record<
  Scope,
  { label: string; hint: string; chip: string }
> = {
  device: {
    label: "This browser",
    hint: "Only this browser. Another device keeps its own value.",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  account: {
    label: "Your account",
    hint: "Follows you to every device. Nobody else sees it.",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  deployment: {
    label: "Everyone",
    hint: "One value for every account on this deployment. Admins only.",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  tool: {
    label: "Tool",
    hint: "Not a setting. Looks at or acts on the system.",
    chip: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  },
}

export type Item =
  | { kind: "setting"; id: string }
  | { kind: "panel"; id: string; label: string; render: () => React.ReactNode }

export interface Group {
  id: string
  label: string
  icon: LucideIcon
  scope: Scope
  /** One sentence on what the group is for, in the reader's terms. */
  blurb: string
  items: Item[]
}

export interface Area {
  id: "account" | "you" | "deployment" | "tools"
  label: string
  groups: Group[]
}

const s = (...ids: string[]): Item[] =>
  ids.map((id) => ({ kind: "setting", id }))
const panel = (
  id: string,
  label: string,
  render: () => React.ReactNode,
): Item => ({ kind: "panel", id, label, render })

export const AREAS: Area[] = [
  {
    id: "account",
    label: "Account",
    groups: [
      {
        id: "profile",
        label: "Profile",
        icon: User,
        scope: "account",
        blurb: "Your name and email address.",
        items: [panel("profile", "Profile", () => <UserInformation />)],
      },
      {
        id: "password",
        label: "Password",
        icon: Lock,
        scope: "account",
        blurb: "Change the password you sign in with.",
        items: [panel("password", "Password", () => <ChangePassword />)],
      },
      {
        id: "usage",
        label: "Usage",
        icon: BarChart3,
        scope: "account",
        blurb: "Today's Telegram Requests against your Budgets.",
        items: [panel("usage", "Usage", () => <MyQuota />)],
      },
      {
        id: "danger",
        label: "Delete account",
        icon: UserX,
        scope: "account",
        blurb: "Delete your account and everything it owns.",
        items: [panel("danger", "Delete account", () => <DeleteAccount />)],
      },
    ],
  },
  {
    id: "you",
    label: "Your settings",
    groups: [
      {
        id: "display",
        label: "Display",
        icon: Monitor,
        scope: "device",
        blurb: "Theme and what a channel card shows.",
        items: s(
          "theme",
          "showChannelBio",
          "showChannelSubscribers",
          "showChannelTelegramChatId",
          "showChannelPhotos",
          "showChannelVideos",
          "showChannelFiles",
          "showChannelLinks",
          "showChannelStartId",
        ),
      },
      {
        id: "ai",
        label: "AI",
        icon: Cpu,
        scope: "device",
        blurb:
          "Which model writes your Summaries and Chats, and in what language.",
        items: s(
          "aiLanguage",
          "selectedModel",
          "aiTemperature",
          "embeddingsEnabled",
          "embeddingsPaused",
        ),
      },
      {
        id: "ai-keys",
        label: "AI keys",
        icon: KeyRound,
        scope: "account",
        blurb: "The keys your Summaries, Chats and Tags are paid with.",
        items: [panel("ai-keys", "AI keys", () => <AIKeysPanel />)],
      },
      {
        id: "follows",
        label: "New follows",
        icon: RefreshCw,
        scope: "account",
        blurb: "How far back a new follow reaches, and its sync defaults.",
        items: s(
          "globalStartTimeMode",
          "globalStartTimeValue",
          "dynamicSyncEnabledDefault",
          "dynamicSyncExpectedPostsDefault",
        ),
      },
      {
        id: "setting-groups",
        label: "Setting groups",
        icon: Layers,
        scope: "account",
        blurb: "Named sync schedules you put channels into.",
        items: [
          panel("setting-groups", "Setting groups", () => (
            <SettingGroupsPanel />
          )),
        ],
      },
      {
        id: "publishing",
        label: "Publishing",
        icon: Send,
        scope: "account",
        blurb: "Bots and the Telegram chats your Summaries are posted to.",
        items: [
          panel("bots", "Bot credentials", () => (
            <BotManagement focus="bot-credentials" highlightId={null} />
          )),
          panel("destinations", "Destinations", () => (
            <BotManagement focus="destinations" highlightId={null} />
          )),
        ],
      },
      {
        id: "my-data",
        label: "Your data",
        icon: Upload,
        scope: "account",
        blurb: "How long your logs and reports are kept, and export/import.",
        items: [
          ...s("logRetentionDays", "reportRetentionDays", "reportRetentionMax"),
          panel("transfer", "Export and import", () => (
            <DatabaseManagement focus="transfer" highlightId={null} />
          )),
        ],
      },
    ],
  },
  {
    id: "deployment",
    label: "Deployment",
    groups: [
      {
        id: "sync-policy",
        label: "Sync schedule",
        icon: RefreshCw,
        scope: "deployment",
        blurb:
          "How often the worker syncs every channel, and how it backs off.",
        items: s("regularSyncIntervalMinutes", "syncFailureBackoffMinutes"),
      },
      {
        id: "reach",
        label: "Reach",
        icon: BarChart3,
        scope: "deployment",
        blurb: "When a View count counts as settled, for every account.",
        items: s(
          "settlingAgeHours",
          "estimationFloorHours",
          "reachSampleSize",
          "curveRefitIntervalHours",
        ),
      },
      {
        id: "translation",
        label: "Translation",
        icon: Languages,
        scope: "deployment",
        blurb: "Post translation, run on the Operator key for everyone.",
        items: s(
          "translationEnabled",
          "autoTranslate",
          "translationTargetLanguage",
          "translationModel",
        ),
      },
      {
        id: "proxy",
        label: "Proxies",
        icon: Shield,
        scope: "deployment",
        blurb: "Where Telegram traffic leaves from, and how many at once.",
        items: [
          panel("proxy", "Proxies", () => (
            <NetworkSection focus="proxy" highlightId={null} />
          )),
        ],
      },
      {
        id: "tor",
        label: "Tor",
        icon: Globe,
        scope: "deployment",
        blurb: "Route Telegram traffic through Tor instead.",
        items: [
          panel("tor", "Tor", () => (
            <NetworkSection focus="tor" highlightId={null} />
          )),
        ],
      },
      {
        id: "corpus-retention",
        label: "Corpus retention",
        icon: Database,
        scope: "deployment",
        blurb: "How long shared Posts and ownerless logs are kept.",
        items: s("postRetentionDays", "sharedLogRetentionDays"),
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    groups: [
      {
        id: "diagnostics",
        label: "Diagnostics",
        icon: Activity,
        scope: "tool",
        blurb: "Health of the worker, queues and jobs.",
        items: [panel("diagnostics", "Diagnostics", () => <DiagnosticsView />)],
      },
      {
        id: "telemetry",
        label: "Network telemetry",
        icon: Globe,
        scope: "tool",
        blurb: "What each proxy is answering right now.",
        items: [
          panel("telemetry", "Network telemetry", () => <NetworkTelemetry />),
        ],
      },
      {
        id: "table-sizes",
        label: "Table sizes",
        icon: Layers,
        scope: "tool",
        blurb: "How big each table is.",
        items: [
          panel("table-sizes", "Table sizes", () => (
            <DatabaseManagement focus="table-sizes" highlightId={null} />
          )),
        ],
      },
      {
        id: "query",
        label: "SQL query",
        icon: Braces,
        scope: "tool",
        blurb: "Run a read-only query against the database.",
        items: [
          panel("query", "SQL query", () => (
            <DatabaseManagement focus="query" highlightId={null} />
          )),
        ],
      },
      {
        id: "quick-message",
        label: "Quick message",
        icon: Bot,
        scope: "tool",
        blurb: "Send one message through a bot.",
        items: [
          panel("quick-message", "Quick message", () => (
            <BotManagement focus="quick-message" highlightId={null} />
          )),
        ],
      },
      {
        id: "configuration",
        label: "Configuration catalog",
        icon: Layers,
        scope: "tool",
        blurb:
          "Every knob the deployment reads, and where its value came from.",
        items: [
          panel("configuration", "Configuration catalog", () => (
            <ConfigurationCatalogView />
          )),
        ],
      },
    ],
  },
]

export const ALL_GROUPS = AREAS.flatMap((a) => a.groups)

export const findGroup = (id: string | undefined) =>
  ALL_GROUPS.find((g) => g.id === id)

export function itemLabel(item: Item): string {
  return item.kind === "panel"
    ? item.label
    : (getCatalogEntry(item.id)?.label ?? item.id)
}

export function itemText(item: Item, group: Group): string {
  const entry = item.kind === "setting" ? getCatalogEntry(item.id) : undefined
  return [
    itemLabel(item),
    entry?.description,
    entry?.keywords.join(" "),
    group.label,
    group.blurb,
  ]
    .join(" ")
    .toLowerCase()
}

/** Which catalog ids in a group differ from their default. */
export function useModifiedIds(): (group: Group) => string[] {
  const settings = useSettings() as unknown as Record<string, unknown>
  return (group) =>
    group.items.flatMap((item) => {
      if (item.kind !== "setting") return []
      const entry = getCatalogEntry(item.id)
      if (!entry) return []
      const value = settings[(entry.sliceKey ?? entry.id) as string]
      return isSettingModified(entry, value) ? [item.id] : []
    })
}

export const ScopeChip: React.FC<{ scope: Scope; className?: string }> = ({
  scope,
  className,
}) => (
  <span
    title={SCOPE_META[scope].hint}
    className={cn(
      "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest",
      SCOPE_META[scope].chip,
      className,
    )}
  >
    {SCOPE_META[scope].label}
  </span>
)

/** One item, drawn the same way in every variant. */
export const ItemView: React.FC<{ item: Item }> = ({ item }) => {
  if (item.kind === "panel") return <div>{item.render()}</div>
  const entry = getCatalogEntry(item.id)
  return entry ? <CatalogSettingRow entry={entry} /> : null
}

/** A group's items with its heading, the body every variant reuses. */
export const GroupBody: React.FC<{ group: Group; heading?: boolean }> = ({
  group,
  heading = true,
}) => (
  <section
    className={cn(group.scope === "tool" && "terminal-theme text-app-ink")}
  >
    {heading && (
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <group.icon size={16} className="opacity-60" />
          <h3 className="text-sm font-bold uppercase tracking-widest">
            {group.label}
          </h3>
          <ScopeChip scope={group.scope} />
        </div>
        <p className="mt-1 text-xs opacity-60">{group.blurb}</p>
      </header>
    )}
    <div className="space-y-4">
      {group.items.map((item) => (
        <ItemView key={item.id} item={item} />
      ))}
    </div>
  </section>
)
