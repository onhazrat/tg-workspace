/**
 * PROTOTYPE (settings redesign), throwaway. Everything `/settings` and
 * `/admin` hold today, as pages inside the workspace Settings tab. Each body
 * is the production component, unchanged; only where it is mounted moves.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import type React from "react"
import { Suspense, useEffect, useRef } from "react"
import { type UserPublic, usersReadUsers } from "@/client"
import AddUser from "@/components/Admin/AddUser"
import { columns, type UserTableData } from "@/components/Admin/columns"
import QuotaLimits from "@/components/Admin/QuotaLimits"
import QuotaUsage from "@/components/Admin/QuotaUsage"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import { SETTINGS_SECTION_CONTENT } from "@/components/settings/SettingsHubParts"
import {
  loadsDbStats,
  sectionThemeClass,
} from "@/components/settings/settings-hub-model"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import MyQuota from "@/components/UserSettings/MyQuota"
import UserInformation from "@/components/UserSettings/UserInformation"
import useAuth from "@/hooks/useAuth"
import { useLoadDBStats } from "@/hooks/useDBStats"
import type { SettingsSection } from "@/lib/settings/toc"
import { cn } from "@/lib/utils"
import { AddUserAction, USERS_BODY, type UsersStyle } from "./users-variants"

export type PageArea = "account" | "admin"

export interface ProtoPage {
  id: string
  area: PageArea
  label: string
  /** Where it lives on main today. */
  from: string
  /** A section of the current hub this page reuses, if any. */
  section?: SettingsSection
  body?: React.FC
  /** Hidden for a superuser, who cannot delete itself. */
  notForSuperuser?: boolean
}

function UsersTableContent() {
  const { user: me } = useAuth()
  const { data } = useSuspenseQuery({
    queryFn: () => usersReadUsers({ query: { skip: 0, limit: 100 } }),
    queryKey: ["users"],
  })
  const rows: UserTableData[] = data.data.map((u: UserPublic) => ({
    ...u,
    isCurrentUser: me?.id === u.id,
  }))
  return <DataTable columns={columns} data={rows} />
}

const Users: React.FC = () => (
  <div className="space-y-4">
    <div className="flex justify-end">
      <AddUser />
    </div>
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  </div>
)

const Quotas: React.FC = () => (
  <div className="space-y-10">
    <QuotaLimits />
    <QuotaUsage />
  </div>
)

export const PAGES: ProtoPage[] = [
  {
    id: "profile",
    area: "account",
    label: "Profile",
    from: "/settings",
    body: UserInformation,
  },
  {
    id: "password",
    area: "account",
    label: "Password",
    from: "/settings",
    body: ChangePassword,
  },
  {
    id: "usage",
    area: "account",
    label: "Usage",
    from: "/settings",
    body: MyQuota,
  },
  {
    id: "logs",
    area: "account",
    label: "Activity logs",
    from: "Settings → Tools → Diagnostics",
    section: "diagnostics",
  },
  {
    id: "danger",
    area: "account",
    label: "Delete account",
    from: "/settings → Danger zone",
    body: DeleteAccount,
    notForSuperuser: true,
  },
  {
    id: "users",
    area: "admin",
    label: "Users",
    from: "/admin",
    body: Users,
  },
  {
    id: "quotas",
    area: "admin",
    label: "Quotas",
    from: "/admin",
    body: Quotas,
  },
  {
    id: "configuration",
    area: "admin",
    label: "Configuration",
    from: "Settings → Tools",
    section: "configuration",
  },
  {
    id: "network-telemetry",
    area: "admin",
    label: "Network telemetry",
    from: "Settings → Tools",
    section: "network-telemetry",
  },
  {
    id: "table-sizes",
    area: "admin",
    label: "Database",
    from: "Settings → Data → Table sizes",
    section: "table-sizes",
  },
  {
    id: "query",
    area: "admin",
    label: "Query console",
    from: "Settings → Data → Query",
    section: "query",
  },
  {
    id: "transfer",
    area: "admin",
    label: "Import / export",
    from: "Settings → Data → Transfer",
    section: "transfer",
  },
]

export const AREA_LABEL: Record<PageArea, string> = {
  account: "Account",
  admin: "Admin",
}

export const PageView: React.FC<{
  page: ProtoPage
  onBack: () => void
  users?: UsersStyle
}> = ({ page, onBack, users }) => {
  const loadDBStats = useLoadDBStats()
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" })
    if (page.section && loadsDbStats(page.section)) void loadDBStats()
  }, [page, loadDBStats])
  const restyled = page.id === "users" && users
  const Body = restyled ? USERS_BODY[users] : page.body
  return (
    <div
      ref={top}
      className={cn(
        "min-h-full scroll-mt-8",
        page.section && sectionThemeClass(page.section),
      )}
    >
      <div className="border-b border-app-ink/10 px-8 py-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] text-app-ink/60 hover:text-app-ink md:hidden"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-app-ink/50">
              {AREA_LABEL[page.area]}
            </div>
            <h3 className="text-lg font-semibold">{page.label}</h3>
            <p className="text-[13px] text-app-ink/45">Today: {page.from}</p>
          </div>
          {restyled ? <AddUserAction /> : null}
        </div>
      </div>
      <div className="max-w-5xl p-8">
        {Body ? (
          <Body />
        ) : page.section ? (
          SETTINGS_SECTION_CONTENT[page.section]({ highlightId: null })
        ) : null}
      </div>
    </div>
  )
}
