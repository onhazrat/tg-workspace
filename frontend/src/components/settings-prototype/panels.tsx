/**
 * PROTOTYPE, throw away. The hand-written parts of Settings: what `/settings`
 * and `/admin` used to be, plus the production panels that are more than a row
 * (keys, bots, proxies, groups). Each has a nested id like a setting, so search,
 * deep links and the TOC treat it as one. Bodies are the production components,
 * unchanged, and **their writes are real** (they go to the deployment).
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { LogOut } from "lucide-react"
import type React from "react"
import { Suspense } from "react"
import { type UserPublic, usersReadUsers } from "@/client"
import AddUser from "@/components/Admin/AddUser"
import { columns, type UserTableData } from "@/components/Admin/columns"
import QuotaLimits from "@/components/Admin/QuotaLimits"
import QuotaUsage from "@/components/Admin/QuotaUsage"
import { BotManagement } from "@/components/BotManagement"
import { DataTable } from "@/components/Common/DataTable"
import { SettingGroupsPanel } from "@/components/SettingGroupsPanel"
import { AIKeysPanel } from "@/components/settings/ai/AIKeysPanel"
import { NetworkSection } from "@/components/settings/NetworkSection"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import MyQuota from "@/components/UserSettings/MyQuota"
import UserInformation from "@/components/UserSettings/UserInformation"
import { TgButton } from "@/components/ui/tg-button"
import useAuth from "@/hooks/useAuth"

export interface Panel {
  id: string
  topic: string
  title: string
  description: string
  keywords: string
  /** Which permission shows it; none means every account. */
  permission?: string
  hideForSuperuser?: boolean
  render: () => React.ReactNode
}

function SignOut() {
  const { user, logout } = useAuth()
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-xs text-app-ink/60">
        Signed in as{" "}
        <span className="font-semibold text-app-ink">{user?.email}</span>
      </p>
      <TgButton variant="secondary" size="sm" onClick={logout}>
        <LogOut size={14} /> Sign out
      </TgButton>
    </div>
  )
}

function UsersTable() {
  const { user: me } = useAuth()
  const { data } = useSuspenseQuery({
    queryKey: ["users"],
    queryFn: () => usersReadUsers({ query: { skip: 0, limit: 100 } }),
  })
  const rows: UserTableData[] = data.data.map((u: UserPublic) => ({
    ...u,
    isCurrentUser: me?.id === u.id,
  }))
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AddUser />
      </div>
      <DataTable columns={columns} data={rows} />
    </div>
  )
}

export const PANELS: Panel[] = [
  {
    id: "account.yours.signIn",
    topic: "account",
    title: "Signed in",
    description: "The account this browser is using.",
    keywords: "sign out logout log out email",
    render: () => <SignOut />,
  },
  {
    id: "account.yours.profile",
    topic: "account",
    title: "Profile",
    description: "Your name and email address.",
    keywords: "name email profile user",
    render: () => <UserInformation />,
  },
  {
    id: "account.yours.password",
    topic: "account",
    title: "Password",
    description: "Change the password you sign in with.",
    keywords: "password change",
    render: () => <ChangePassword />,
  },
  {
    id: "account.yours.usage",
    topic: "account",
    title: "Usage",
    description: "Telegram Requests your account made today, per Budget.",
    keywords: "quota budget usage requests",
    render: () => <MyQuota />,
  },
  {
    id: "account.yours.delete",
    topic: "account",
    title: "Delete account",
    description: "Removes your account and everything it owns.",
    keywords: "delete danger remove account",
    hideForSuperuser: true,
    render: () => <DeleteAccount />,
  },
  {
    id: "ai.yours.keys",
    topic: "ai",
    title: "AI keys",
    description: "The Keys your Summaries, Chats and Tags are paid with.",
    keywords: "api key gemini openai openrouter provider byok",
    render: () => <AIKeysPanel />,
  },
  {
    id: "sync.yours.settingGroups",
    topic: "sync",
    title: "Setting groups",
    description: "Sync and summary rules shared by a set of channels.",
    keywords: "group groups channel rules",
    render: () => <SettingGroupsPanel />,
  },
  {
    id: "publishing.yours.bots",
    topic: "publishing",
    title: "Bot credentials",
    description: "Telegram bots that publish your Summaries.",
    keywords: "bot token telegram publish",
    render: () => <BotManagement focus="bot-credentials" />,
  },
  {
    id: "publishing.yours.destinations",
    topic: "publishing",
    title: "Destinations",
    description: "Chats and channels your bots publish to.",
    keywords: "destination chat channel publish",
    render: () => <BotManagement focus="destinations" />,
  },
  {
    id: "network.deployment.proxies",
    topic: "network",
    title: "Proxies",
    description: "The proxy pool every sync goes through.",
    keywords: "proxy proxies socks http pool",
    permission: "data:admin",
    render: () => <NetworkSection focus="proxy" />,
  },
  {
    id: "network.deployment.tor",
    topic: "network",
    title: "Tor",
    description: "Route syncs through Tor.",
    keywords: "tor onion",
    permission: "data:admin",
    render: () => <NetworkSection focus="tor" />,
  },
  {
    id: "admin.users.list",
    topic: "admin",
    title: "Users",
    description: "Every account, its role and approval; View as from the menu.",
    keywords: "users accounts approve role view as superuser admin",
    permission: "users:read",
    render: () => (
      <Suspense fallback={<p className="text-xs opacity-50">Loading users…</p>}>
        <UsersTable />
      </Suspense>
    ),
  },
  {
    id: "admin.quota.limits",
    topic: "admin",
    title: "Quota limits",
    description: "Per-account allowance and ceiling for each Budget.",
    keywords: "quota limit allowance ceiling budget",
    permission: "quota:manage",
    render: () => <QuotaLimits />,
  },
  {
    id: "admin.quota.usage",
    topic: "admin",
    title: "Quota usage",
    description: "What each account spent today.",
    keywords: "quota usage requests budget",
    permission: "quota:read_any",
    render: () => <QuotaUsage />,
  },
]

export const PANEL_TOPICS = [
  { id: "account", title: "Account" },
  { id: "admin", title: "Admin" },
]

export function visiblePanels(
  permissions: string[],
  isSuperuser: boolean,
): Panel[] {
  return PANELS.filter(
    (p) =>
      (!p.permission || permissions.includes(p.permission)) &&
      !(p.hideForSuperuser && isSuperuser),
  )
}

export function panelMatches(panel: Panel, query: string): boolean {
  const words = query
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("@"))
    .map((w) => w.toLowerCase())
  if (query.includes("@modified") || query.includes("@restart")) return false
  const hay =
    `${panel.id} ${panel.title} ${panel.description} ${panel.keywords}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}
