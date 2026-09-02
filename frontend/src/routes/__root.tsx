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
import ViewAsRibbon from "@/components/ViewAsRibbon"

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
      {/* Above every route, because a View-as session is a property of the
          browser and not of one route subtree — `/summarizer` is under `_tg`,
          which the app shell does not wrap (ticket 26). */}
      <ViewAsRibbon />
      <Outlet />
      <AppToaster />
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  ),
  notFoundComponent: () => <NotFound />,
  errorComponent: () => <ErrorComponent />,
})
