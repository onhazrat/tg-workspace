import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { usersReadUserMe } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import { syncServerClock } from "@/lib/analysis-window"
import { queryClient } from "@/lib/queryClient"

/**
 * PROTOTYPE: the only app shell now that the template's `_layout` is gone, so it
 * takes over the two things that shell did on the way in: the awaited server
 * clock sync (AW-02) and the approval redirect.
 */
export const Route = createFileRoute("/_tg")({
  component: () => <Outlet />,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({ to: "/login" })
    }
    await syncServerClock()
    let user: Awaited<ReturnType<typeof usersReadUserMe>> | undefined
    try {
      user = await queryClient.ensureQueryData({
        queryKey: ["currentUser"],
        queryFn: () => usersReadUserMe(),
      })
    } catch {
      return
    }
    if (user && user.is_approved === false) {
      throw redirect({ to: "/pending-approval" })
    }
  },
})
