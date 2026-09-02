import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { usersReadUserMe } from "@/client"
import { Footer } from "@/components/Common/Footer"
import QuotaWarning from "@/components/QuotaWarning"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import useViewAs from "@/hooks/useViewAs"
import { queryClient } from "@/lib/queryClient"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }

    // Someone waiting for approval holds a valid token, so the check above lets
    // them through — and then every query underneath 403s and they get a wall
    // of errors instead of an explanation. Resolved here rather than inside the
    // shell so none of it renders and none of those requests are sent.
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

function Layout() {
  // Only to move the page header out from under the ribbon. The ribbon itself
  // reads the token directly and needs nothing from here.
  const { isViewingAs } = useViewAs()

  return (
    // `__root.tsx` renders the ribbon above every route; what is left here is
    // the shell making room for it (ticket 26).
    <div className="flex min-h-[calc(100svh-var(--view-as-offset))] w-full flex-col">
      <SidebarProvider className="min-h-0 flex-1">
        <AppSidebar />
        <SidebarInset>
          {/* Both stick to the top, so the header has to start below the
            ribbon or it slides underneath it and takes the sidebar trigger
            with it. */}
          <header
            className={cn(
              "sticky z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4",
              isViewingAs ? "top-[var(--view-as-offset)]" : "top-0",
            )}
          >
            <SidebarTrigger className="-ml-1 text-muted-foreground" />
          </header>
          <main className="flex-1 p-6 md:p-8">
            <div className="app-shell">
              {/* In the shell rather than on the pages that start syncs, because
                a Budget running out is a fact about the account and not about
                the screen it was noticed on (ticket 24). */}
              <QuotaWarning />
              <Outlet />
            </div>
          </main>
          <Footer />
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

export default Layout
