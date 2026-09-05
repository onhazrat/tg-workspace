import { createFileRoute } from "@tanstack/react-router"

import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import MyQuota from "@/components/UserSettings/MyQuota"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"

const tabsConfig = [
  { value: "my-profile", title: "My profile", component: UserInformation },
  { value: "password", title: "Password", component: ChangePassword },
  { value: "usage", title: "Usage", component: MyQuota },
  { value: "danger-zone", title: "Danger zone", component: DeleteAccount },
]

/**
 * A superuser cannot delete its own account, so it gets no Danger zone.
 *
 * This was `tabsConfig.slice(0, 3)`, which stated the rule as a position. The
 * template shipped four tabs with Danger zone last; dropping one of the others
 * turned the slice into a no-op that kept every tab, and ticket 24's Usage tab
 * then pushed Danger zone back out of it with no diff saying so. Name the tab
 * the rule is about, so adding a fifth one changes nothing here.
 */
const SUPERUSER_HIDDEN_TABS = new Set(["danger-zone"])

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [
      {
        title: "Settings - FastAPI Template",
      },
    ],
  }),
})

function UserSettings() {
  const { user: currentUser } = useAuth()
  const finalTabs = currentUser?.is_superuser
    ? tabsConfig.filter((tab) => !SUPERUSER_HIDDEN_TABS.has(tab.value))
    : tabsConfig

  if (!currentUser) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <Tabs defaultValue="my-profile">
        <TabsList>
          {finalTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {finalTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
