import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { usersReadUserMe } from "@/client"
import { CompleteWindowSwitcher } from "@/components/complete-window-prototype/PrototypeSwitcher"
import { isLoggedIn } from "@/hooks/useAuth"
import { syncServerClock } from "@/lib/analysis-window"
import { queryClient } from "@/lib/queryClient"

/**
 * The app's only shell since the template's `_layout` left (SET-01), so it
 * does the two things that shell did on the way in.
 */
export const Route = createFileRoute("/_tg")({
  component: () => (
    <>
      <Outlet />
      <CompleteWindowSwitcher />
    </>
  ),
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({ to: "/login" })
    }

    // AW-02, and awaited on purpose. `fixedWindow` holds a window's end to the
    // server's current minute, and until this resolves the offset is zero, so
    // "the server's minute" is the browser's. On a clock running fast that
    // sends an end the server has not reached and every scoped request 422s —
    // a worse failure than the skew the ticket set out to remove.
    //
    // Here rather than at module load because `/utils/server-time` is
    // authenticated: at boot there may be no token yet, and login is a
    // client-side navigate with no reload, so a boot-only sync would 401 once
    // and never be retried. This runs after the token exists and before the
    // workspace's first feed or counts call.
    await syncServerClock()

    // Someone waiting for approval holds a valid token, so the check above lets
    // them through — and then every query underneath 403s and they get a wall
    // of errors instead of an explanation. Resolved here rather than inside the
    // workspace so none of it renders and none of those requests are sent.
    //
    // `ensureQueryData` on the key `useAuth` already uses, so this is the same
    // fetch the app was going to make, not a second one.
    let user: Awaited<ReturnType<typeof usersReadUserMe>> | undefined
    try {
      user = await queryClient.ensureQueryData({
        queryKey: ["currentUser"],
        queryFn: () => usersReadUserMe(),
      })
    } catch {
      // A failed lookup is a stale or rejected token, which the transport
      // already handles by clearing the session and hard-redirecting. Falling
      // through leaves that path alone rather than racing it with a second
      // redirect that would swallow the reason.
      return
    }

    if (user && user.is_approved === false) {
      throw redirect({ to: "/pending-approval" })
    }
  },
})
