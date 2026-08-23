import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { usersReadUserMe } from "@/client"
import { Footer } from "@/components/Common/Footer"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import { queryClient } from "@/lib/queryClient"

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
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
        </header>
        <main className="flex-1 p-6 md:p-8">
          <div className="app-shell">
            <Outlet />
          </div>
        </main>
        <Footer />
      </SidebarInset>
    </SidebarProvider>
  )
}

export default Layout
