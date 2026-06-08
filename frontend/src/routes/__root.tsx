import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import {
  createRootRoute,
  HeadContent,
  Outlet,
  useRouterState,
} from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import ErrorComponent from "@/components/Common/ErrorComponent"
import NotFound from "@/components/Common/NotFound"
import { Toaster } from "@/components/ui/sonner"

function AppToaster() {
  const isSummarizerRoute = useRouterState({
    select: (state) => state.location.pathname.startsWith("/summarizer"),
  })

  if (isSummarizerRoute) {
    return null
  }

  return <Toaster richColors closeButton />
}

export const Route = createRootRoute({
  component: () => (
    <>
      <HeadContent />
      <Outlet />
      <AppToaster />
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  ),
  notFoundComponent: () => <NotFound />,
  errorComponent: () => <ErrorComponent />,
})
