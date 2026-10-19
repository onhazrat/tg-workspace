import { createFileRoute, redirect } from "@tanstack/react-router"

/** The app moved from /workspace to /. Old links keep their query string. */
export const Route = createFileRoute("/_tg/workspace")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/${location.searchStr}`, replace: true })
  },
})
