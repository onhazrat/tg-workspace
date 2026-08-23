import { createFileRoute, redirect } from "@tanstack/react-router"
import { Clock } from "lucide-react"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { Button } from "@/components/ui/button"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"

/**
 * Where an account waits between signing up and an administrator approving it.
 *
 * A real route rather than a panel rendered in place of the app, so the URL says
 * what is on screen — a reload or a shared link lands here instead of on
 * `/summarizer` showing something else entirely.
 *
 * It sits outside `_layout` deliberately: that layout is the application shell,
 * and everything in it would fail against the API for someone in this state.
 */
export const Route = createFileRoute("/pending-approval")({
  component: PendingApproval,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({ to: "/login" })
    }
  },
})

function PendingApproval() {
  const { user, logout } = useAuth()

  // Approved already — most likely an admin just clicked approve and this tab
  // refetched. Send them into the app rather than leaving them on a page whose
  // whole premise has expired.
  if (user?.is_approved) {
    throw redirect({ to: "/summarizer", search: { tab: "summary" } })
  }

  return (
    <AuthLayout>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-muted p-3">
          <Clock className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Awaiting approval</h1>
          <p className="text-sm text-muted-foreground">
            Your account was created. An administrator needs to approve it
            before you can use the app.
          </p>
          {user?.email ? (
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-medium">{user.email}</span>
            </p>
          ) : null}
        </div>

        <Button variant="outline" className="w-full" onClick={logout}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}

export default PendingApproval
