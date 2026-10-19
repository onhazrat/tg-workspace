import type React from "react"

import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import MyQuota from "@/components/UserSettings/MyQuota"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TgButton } from "@/components/ui/tg-button"
import useAuth from "@/hooks/useAuth"

const PANELS = [
  { id: "profile", title: "My profile", component: UserInformation },
  { id: "password", title: "Password", component: ChangePassword },
  { id: "usage", title: "Usage", component: MyQuota },
  { id: "danger-zone", title: "Danger zone", component: DeleteAccount },
] as const

/**
 * The template's /settings tabs, moved here unchanged until SET-03 redraws
 * them. A superuser cannot delete its own account, so it gets no Danger zone;
 * the rule names the panel rather than a position, so adding one changes
 * nothing here.
 */
export function accountPanels(isSuperuser: boolean) {
  return isSuperuser ? PANELS.filter((p) => p.id !== "danger-zone") : PANELS
}

/** Who is signed in, and the way out the template sidebar used to hold. */
export const SignedInAs: React.FC<{ email: string; onSignOut: () => void }> = ({
  email,
  onSignOut,
}) => (
  <div className="flex items-center justify-between gap-4 text-sm">
    <p>
      Signed in as <span className="font-semibold">{email}</span>
    </p>
    <TgButton size="sm" variant="secondary" onClick={onSignOut}>
      Sign out
    </TgButton>
  </div>
)

export const AccountSection: React.FC = () => {
  const { user, logout } = useAuth()
  if (!user) return null
  const panels = accountPanels(Boolean(user.is_superuser))
  return (
    <div className="space-y-6" data-testid="settings-account">
      <SignedInAs email={user.email} onSignOut={logout} />
      <Tabs defaultValue="profile">
        <TabsList>
          {panels.map((panel) => (
            <TabsTrigger key={panel.id} value={panel.id}>
              {panel.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {panels.map((panel) => (
          <TabsContent key={panel.id} value={panel.id}>
            <panel.component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
